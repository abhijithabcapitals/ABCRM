import { useCallback, useEffect, useState } from "react";
import chatApi from "../services/chatClient.js";
import { openLink } from "../services/desktop.js";
import { chatTitle } from "../logic/chat.js";
import { rowTime } from "../logic/app.js";
import { formatBytes } from "../logic/parity.js";

// The files in this person's chats, newest first. Mounted only while the section is open, so it always loads fresh.
export default function FilesSection({ chats }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setRows((await chatApi.files()) || []);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => { const first = setTimeout(load, 0); return () => clearTimeout(first); }, [load]);

  const open = (id) => openLink(() => chatApi.fileLink(id)).catch((e) => setError(e.message));

  const titleOf = (f) => {
    const chat = chats.find((c) => c.id === f.conversation_id);
    return chat ? chatTitle(chat) : f.conversation_title || "";
  };

  return (
    <section className="abm-page" aria-label="Files">
      <header className="abm-side-head"><h2>Files</h2></header>
      <div className="abm-side-body">
        {error && <div className="abm-list-note" role="alert"><p>{error}</p><button type="button" className="abm-btn" onClick={load}>Try again</button></div>}
        {!error && rows === null && <div aria-label="Loading files" role="status"><div className="abm-skeleton" /><div className="abm-skeleton" /></div>}
        {rows?.length === 0 && !error && <p className="abm-list-note">No files yet. Files shared in your chats will show here.</p>}
        {rows?.length > 0 && (
          <ul className="abm-list">
            {rows.map((f) => (
              <li key={f.id}>
                <button type="button" className="abm-row" aria-label={`Download ${f.file_name}`} onClick={() => open(f.id)}>
                  <span className="abm-row-main">
                    <strong>{f.file_name}</strong>
                    <span className="abm-row-sub">{[titleOf(f), f.uploader_name, formatBytes(f.size_bytes)].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="abm-row-side">{rowTime(f.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
