import { useCallback, useEffect, useState } from "react";
import inboxApi from "../services/inboxClient.js";

// The conversations of one connected channel. A new message on any account reloads the list.
export default function useChannelThreads(channel, active) {
  const [threads, setThreads] = useState(null);
  const [problem, setProblem] = useState("");

  const load = useCallback(async () => {
    if (!active) return;
    try {
      setThreads(await inboxApi.channelThreads(channel));
      setProblem("");
    } catch (e) {
      setProblem(e.message);
    }
  }, [channel, active]);

  useEffect(() => {
    if (!active) return undefined;
    const first = setTimeout(load, 0);
    const stop = inboxApi.subscribeInbox(load);
    window.addEventListener("focus", load);
    return () => { clearTimeout(first); stop(); window.removeEventListener("focus", load); };
  }, [active, load]);

  return { threads, problem, reload: load };
}
