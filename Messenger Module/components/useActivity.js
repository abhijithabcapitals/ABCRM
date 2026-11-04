import { useCallback, useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";

// The activity feed. A live message or change may mean something new here, so each one reloads it.
export default function useActivity(profileId, onMessage) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!profileId) return;
    try {
      setRows((await chatApi.activity()) || []);
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoaded(true);
    }
  }, [profileId]);

  useEffect(() => {
    const first = setTimeout(reload, 0);
    window.addEventListener("focus", reload);
    const stop = onMessage(reload);
    return () => { clearTimeout(first); window.removeEventListener("focus", reload); stop(); };
  }, [reload, onMessage]);

  const markRead = useCallback(async (id) => {
    const at = new Date().toISOString();
    setRows((cur) => cur.map((r) => (!id || r.id === id ? { ...r, read_at: r.read_at || at } : r)));
    try { await chatApi.activityRead(id); } catch { reload(); }
  }, [reload]);

  return { rows, error, loaded, unread: rows.filter((r) => !r.read_at).length, reload, markRead };
}
