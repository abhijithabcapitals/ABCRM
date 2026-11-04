import { useCallback, useEffect, useMemo, useState } from "react";
import chatApi from "../services/chatClient.js";
import { presenceLabel, presenceState } from "../logic/parity.js";

const BEAT_MS = 2 * 60 * 1000;

// Tells others this window is open, and reads who else is. A failed beat changes nothing on screen.
export default function usePresence(profileId) {
  const [rows, setRows] = useState([]);

  const beat = useCallback(async (status) => {
    if (!profileId) return;
    try {
      await chatApi.beat(status ?? null);
      setRows((await chatApi.presence()) || []);
    } catch { /* tried again at the next beat */ }
  }, [profileId]);

  useEffect(() => {
    if (!profileId) return undefined;
    const tick = () => { if (document.visibilityState === "visible") beat(); };
    tick();
    const timer = setInterval(tick, BEAT_MS);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [profileId, beat]);

  const byId = useMemo(() => new Map(rows.map((r) => [r.profile_id, r])), [rows]);
  const state = useCallback((id) => presenceState(byId.get(id)), [byId]);
  const label = useCallback((id) => presenceLabel(presenceState(byId.get(id))), [byId]);
  return { state, label, mine: byId.get(profileId)?.status || "available", setStatus: beat };
}
