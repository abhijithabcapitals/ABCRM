import { SECTIONS } from "../logic/app.js";
import { badgeText } from "../logic/chat.js";

const Icon = ({ children }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
const ICONS = {
  activity: <Icon><path d="M6 9a6 6 0 1 1 12 0c0 6 2 7 2 7H4s2-1 2-7" /><path d="M10 20a2 2 0 0 0 4 0" /></Icon>,
  chats: <Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></Icon>,
  teams: <Icon><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><path d="M16 5a3.5 3.5 0 0 1 0 6.5M18 14.5a6 6 0 0 1 3 5.5" /></Icon>,
  calendar: <Icon><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></Icon>,
  calls: <Icon><path d="M21 16.5v3a2 2 0 0 1-2.2 2A18 18 0 0 1 2.5 5.2 2 2 0 0 1 4.500 3h3a1.500 1.500 0 0 1 1.500 1.300l.5 3a1.500 1.500 0 0 1-.5 1.400L7.300 10.300a15 15 0 0 0 6.400 6.400l1.600-1.700a1.500 1.500 0 0 1 1.400-.5l3 .5a1.500 1.500 0 0 1 1.300 1.500z" /></Icon>,
  files: <Icon><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></Icon>,
};

// The strip that switches between the page's sections: a left column, or a bottom row on phones.
export default function AppBar({ section, unread, onSection }) {
  return (
    <nav className="abm-bar" aria-label="Messenger sections">
      {SECTIONS.map((s) => {
        const badge = badgeText(unread[s.key] || 0);
        return (
          <button key={s.key} type="button" className="abm-bar-btn" aria-current={section === s.key ? "page" : undefined}
            aria-label={badge ? `${s.label}, ${badge} unread` : s.label} onClick={() => onSection(s.key)}>
            {ICONS[s.key]}
            <span className="abm-bar-label">{s.label}</span>
            {badge && <span className="abm-badge">{badge}</span>}
          </button>
        );
      })}
    </nav>
  );
}
