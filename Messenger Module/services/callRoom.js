// The only file that talks to LiveKit. Its code loads on the first call, so the CRM pays nothing until then.
// connect() gives back plain controls and plain tiles, so the screen knows nothing about LiveKit.
async function connect({ url, token, media, onChange, onEnded, onProblem }) {
  const { Room, RoomEvent, Track } = await import("livekit-client");
  const room = new Room({ adaptiveStream: true, dynacast: true });
  const audio = new Map(); // remote audio elements, by track

  const tileFor = (p, source, screen) => {
    const pub = p.getTrackPublication(source);
    const track = pub && !pub.isMuted ? pub.track : null;
    return {
      id: `${p.identity}:${screen ? "screen" : "camera"}`,
      name: p.name || "Staff",
      local: p === room.localParticipant,
      screen,
      hasVideo: !!track,
      muted: !p.isMicrophoneEnabled,
      speaking: p.isSpeaking,
      attach: track ? (el) => { track.attach(el); return () => track.detach(el); } : null,
    };
  };
  const emit = (status = "connected") => {
    const people = [room.localParticipant, ...room.remoteParticipants.values()];
    const screens = people.filter((p) => p.isScreenShareEnabled).map((p) => tileFor(p, Track.Source.ScreenShare, true));
    onChange({
      status,
      others: room.remoteParticipants.size,
      tiles: [...screens, ...people.map((p) => tileFor(p, Track.Source.Camera, false))],
      mic: room.localParticipant.isMicrophoneEnabled,
      camera: room.localParticipant.isCameraEnabled,
      sharing: room.localParticipant.isScreenShareEnabled,
    });
  };
  const refresh = () => emit();
  [RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected, RoomEvent.TrackUnsubscribed, RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished,
    RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.ActiveSpeakersChanged, RoomEvent.Reconnected].forEach((e) => room.on(e, refresh));
  room.on(RoomEvent.TrackSubscribed, (track) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.hidden = true;
      document.body.appendChild(el);
      audio.set(track, el);
    }
    refresh();
  });
  room.on(RoomEvent.TrackUnsubscribed, (track) => {
    const el = audio.get(track);
    if (el) { track.detach(el); el.remove(); audio.delete(track); }
  });
  room.on(RoomEvent.Reconnecting, () => emit("reconnecting"));
  let leaving = false;
  room.on(RoomEvent.Disconnected, () => { if (!leaving) onEnded(); });

  await room.connect(url, token);
  await room.startAudio().catch(() => {});

  const enable = async (kind, turnOn, fn) => {
    try {
      await fn(turnOn);
    } catch (e) {
      onProblem(e, kind);
    }
    emit();
  };
  await enable("audio", true, (on) => room.localParticipant.setMicrophoneEnabled(on));
  if (media === "video") await enable("video", true, (on) => room.localParticipant.setCameraEnabled(on));
  emit();

  return {
    setMic: (on) => enable("audio", on, (v) => room.localParticipant.setMicrophoneEnabled(v)),
    setCamera: (on) => enable("video", on, (v) => room.localParticipant.setCameraEnabled(v)),
    setSharing: (on) => enable("screen", on, (v) => room.localParticipant.setScreenShareEnabled(v)),
    devices: (kind) => Room.getLocalDevices(kind),
    setDevice: (kind, id) => room.switchActiveDevice(kind, id),
    leave: async () => {
      leaving = true;
      audio.forEach((el, track) => { track.detach(el); el.remove(); });
      audio.clear();
      await room.disconnect();
    },
  };
}

export const callRoom = { connect };
export default callRoom;
