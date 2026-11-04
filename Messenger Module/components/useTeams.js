import { useCallback, useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";

// The teams and channels this person can see. A live message may change an unread count, so each one reloads the list.
export default function useTeams(profileId, onMessage) {
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    if (!profileId) return;
    try {
      setRows((await chatApi.teamList()) || []);
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

  return { rows, error, loaded, reload };
}
