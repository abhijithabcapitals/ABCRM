import SettingsSection from "./SettingsSection.jsx";

// Chat settings. Kept in this browser, as it only changes how the panel behaves here.
export default function ChatSettings({ keepOpen, onKeepOpen, onBack, onClose, name, isAdmin }) {
  return (
    <section className="msgr-screen" aria-label="Chat settings">
      <header className="msgr-pane-head">
        <button type="button" className="msgr-icon-btn" onClick={onBack} aria-label="Back">←</button>
        <strong className="msgr-head-title">Chat settings</strong>
        <button type="button" className="msgr-close" onClick={onClose} aria-label="Close chat">×</button>
      </header>
      <label className="msgr-setting">
        <input type="checkbox" checked={keepOpen} onChange={(e) => onKeepOpen(e.target.checked)} />
        <span>
          Keep chat open when I click the page
          <small>When this is off, clicking the page closes the chat. The panel always closes with × or Esc.</small>
        </span>
      </label>
      <div className="msgr-setting-more"><SettingsSection name={name} isAdmin={isAdmin} /></div>
    </section>
  );
}
