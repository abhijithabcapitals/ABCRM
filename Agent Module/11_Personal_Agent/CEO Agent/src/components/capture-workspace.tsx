"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";

type Props = { userId: string };
type CaptureMode = "text" | "voice";

export default function CaptureWorkspace({ userId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<CaptureMode>("text");
  const [text, setText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  useEffect(
    () => () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function resetSubmissionKey() {
    idempotencyKeyRef.current = crypto.randomUUID();
  }

  async function startRecording() {
    setError("");
    setStatus("");
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setError("Voice recording is not supported by this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const extension = blob.type.includes("ogg")
          ? "ogg"
          : blob.type.includes("mp4")
            ? "m4a"
            : "webm";
        setAudioFile(
          new File([blob], `voice-note.${extension}`, {
            type: blob.type || "audio/webm",
          }),
        );
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
      setAudioFile(null);
      setText("");
      resetSubmissionKey();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? `Could not start recording: ${cause.message}`
          : "Could not start recording.",
      );
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function discardAudio() {
    setAudioFile(null);
    setStatus("");
    resetSubmissionKey();
  }

  async function submitCapture() {
    const body = text.trim();
    if (audioFile) {
      setError(
        "Voice uploads are not enabled yet. Configure an audio retention policy and cleanup worker before storing recordings.",
      );
      return;
    }
    if (!body && !audioFile) {
      setError("Add a note or record a voice note before saving.");
      return;
    }

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const supabase = createClient();
      const { error: insertError } = await supabase
        .from("captures")
        .insert({
          user_id: userId,
          idempotency_key: idempotencyKeyRef.current,
          input_text: body || null,
        });
      if (insertError && insertError.code !== "23505") throw insertError;
      if (insertError?.code === "23505") {
        const { error: lookupError } = await supabase
          .from("captures")
          .select("id")
          .eq("user_id", userId)
          .eq("idempotency_key", idempotencyKeyRef.current)
          .single();
        if (lookupError) throw lookupError;
      }

      setText("");
      setAudioFile(null);
      resetSubmissionKey();
      setStatus("Capture saved. Use “Suggest records” on it to review AI suggestions.");
      router.refresh();
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Could not save this capture.";
      setError(`Could not save the capture: ${message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="capture-card" aria-labelledby="capture-heading">
      <div className="capture-card-heading">
        <div>
          <p className="eyebrow">QUICK CAPTURE</p>
          <h2 id="capture-heading">What’s on your mind?</h2>
        </div>
        <div className="mode-switch" role="group" aria-label="Capture type">
          <button
            aria-pressed={mode === "text"}
            className={mode === "text" ? "mode-active" : ""}
            onClick={() => setMode("text")}
            type="button"
          >
            Write
          </button>
          <button
            aria-pressed={mode === "voice"}
            className={mode === "voice" ? "mode-active" : ""}
            onClick={() => setMode("voice")}
            type="button"
          >
            Voice
          </button>
        </div>
      </div>
      {mode === "text" ? (
        <label className="capture-label">
          Private note
          <textarea
            maxLength={20000}
            onChange={(event) => {
              setText(event.target.value);
              resetSubmissionKey();
              setError("");
              setStatus("");
            }}
            placeholder="A decision, follow-up, idea or commitment…"
            rows={5}
            value={text}
          />
        </label>
      ) : (
        <div className="voice-panel">
          <p className="muted">
            Recording begins only when you press the button. Your browser will
            ask for microphone permission. The recording stays in this page and
            is not uploaded.
          </p>
          {!recording && !audioFile && (
            <button className="record-button" onClick={startRecording} type="button">
              <span className="record-dot" /> Start recording
            </button>
          )}
          {recording && (
            <button
              className="record-button recording"
              onClick={stopRecording}
              type="button"
            >
              <span className="record-dot" /> Stop recording
            </button>
          )}
          {audioFile && (
            <div className="audio-ready">
              <span>{audioFile.name} · {(audioFile.size / 1024).toFixed(0)} KB</span>
              <button className="text-button" onClick={discardAudio} type="button">
                Remove
              </button>
            </div>
          )}
          <p className="setup-note">
            Voice upload is locked until an audio-retention policy and durable
            cleanup worker are configured. Speech-to-text is not configured.
          </p>
        </div>
      )}
      <div className="capture-actions">
        <span className="character-count">
          {mode === "text" ? `${text.length}/20,000` : "Private by default"}
        </span>
        <button
          className="primary-button"
          disabled={busy || recording || (!text.trim() && !audioFile) || Boolean(audioFile)}
          onClick={submitCapture}
          type="button"
        >
          {busy ? "Saving…" : "Save capture"}
        </button>
      </div>
      {status && (
        <p className="notice notice-success" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
