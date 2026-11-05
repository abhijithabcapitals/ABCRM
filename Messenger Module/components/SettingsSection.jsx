import { lazy, Suspense, useEffect, useState } from "react";
import { readPrefs, savePrefs } from "../logic/desktop.js";
import { appVersion, autostartEnabled, isDesktop, setAutostart } from "../services/desktop.js";

const InboxConnections = lazy(() => import("./InboxConnections.jsx"));

// This person's own settings, kept on this computer. Windows settings show only in the Windows app.
export default function SettingsSection({ name, onSignOut, isAdmin }) {
  const desktop = isDesktop();
  const [prefs, setPrefs] = useState(readPrefs);
  const [autostart, setStart] = useState(null);
  const [version, setVersion] = useState("");
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (!desktop) return;
    autostartEnabled().then(setStart, () => setProblem("Could not read the start-up setting."));
    appVersion().then((v) => setVersion(v || ""), () => {});
  }, [desktop]);

  const change = (key, value) => {
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    savePrefs(next);
  };
  async function flipStart(on) {
    setProblem("");
    try {
      await setAutostart(on);
      setStart(on);
    } catch {
      setProblem("Could not change the start-up setting.");
    }
  }

  return (
    <section className="abm-page abm-form" aria-label="Settings">
      <header className="abm-side-head"><h2>Settings</h2></header>
      <div className="abm-side-body abm-form-body">
        {problem && <p className="abm-problem" role="alert">{problem}</p>}
        {desktop ? (
          <>
            <h3 className="abm-found">Notifications</h3>
            <label className="abm-picker-row"><input type="checkbox" checked={prefs.notifications} onChange={(e) => change("notifications", e.target.checked)} /><span>Show a Windows notification for new messages</span></label>
            <label className="abm-picker-row"><input type="checkbox" checked={prefs.preview} disabled={!prefs.notifications} onChange={(e) => change("preview", e.target.checked)} /><span>Include the message text, which others near your screen may see</span></label>
            <p className="abm-hint">Do not disturb and muted chats stay quiet whatever is set here.</p>
            <h3 className="abm-found">Windows</h3>
            <label className="abm-picker-row"><input type="checkbox" checked={!!autostart} disabled={autostart === null} onChange={(e) => flipStart(e.target.checked)} /><span>Start with Windows, in the tray</span></label>
            <p className="abm-hint">Closing the window keeps Messenger running in the tray. To stop it, right-click its tray icon and choose Quit.</p>
            {version && <p className="abm-hint">AB Capital Services FZE Messenger {version}</p>}
            {onSignOut && (
              <>
                <h3 className="abm-found">Account</h3>
                <p>{name ? `Signed in as ${name}.` : "Signed in."}</p>
                <button type="button" className="abm-btn" onClick={onSignOut}>Sign out</button>
              </>
            )}
          </>
        ) : <p className="abm-list-note">Notifications and start-up settings are in the Windows app. Your status is in the menu under your initials.</p>}
        {isAdmin && (
          <section aria-label="Connected accounts">
            <h3 className="abm-found">Connected accounts</h3>
            <Suspense fallback={null}><InboxConnections /></Suspense>
          </section>
        )}
      </div>
    </section>
  );
}
