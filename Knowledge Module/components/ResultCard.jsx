import { Badge, fmtDate } from "@banking/components/shared";

// One result: title, department, last updated, badges and the two warnings. Children hold the body; footer holds actions.
// status and visibility are optional (service rows have neither). stale is decided by the caller from valid_until.
export default function ResultCard({ title, department, updatedAt, status, visibility, stale, footer, children }) {
  const meta = [department, updatedAt ? `Updated ${fmtDate(updatedAt)}` : null].filter(Boolean).join(" · ");
  return (
    <article className="kn-card">
      <header className="kn-card-head">
        <div>
          <h3>{title}</h3>
          {meta && <p className="kn-meta">{meta}</p>}
        </div>
        <div className="kn-badges">
          {status && <Badge tone={status === "Draft" ? "warn" : "good"}>{status}</Badge>}
          {visibility && <Badge tone={visibility === "Internal" ? "bad" : "plain"}>{visibility}</Badge>}
        </div>
      </header>
      {status === "Draft" && <p className="kn-warn">Draft: confirm before quoting.</p>}
      {stale && <p className="kn-warn">Price may be out of date.</p>}
      {children}
      {footer && <div className="kn-card-foot">{footer}</div>}
    </article>
  );
}
