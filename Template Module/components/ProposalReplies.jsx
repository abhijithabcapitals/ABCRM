// The proposals and options shared with a client or lead, and the client's reply to each. The client replies in the Client Portal, or a CRM user
// records it here (for a lead too). Both write to the proposal itself (Template Hub 014), so this is one line of activity per proposal.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, Modal, Panel, fmtDate, fmtDateTime } from "@banking/components/shared";
import { recordProposalReply } from "../services/proposalApi";
import { optionTotal } from "../logic/proposalModel";
import { replyBy, replyHistory, replyLabel, replyProblem, replyState, replyTone, sharedOptionRows, sharedVia } from "../logic/proposalReplies";

const plain = (n) => Number(n || 0).toLocaleString("en-AE", { maximumFractionDigits: 2 });
const KINDS = [["option", "Chose an option"], ["accepted", "Accepted"], ["declined", "Declined"], ["comment", "Comment only"]];

// The line of activity of one proposal, oldest first.
export function ReplyHistory({ history, options }) {
  if (!history.length) return <p className="bk-muted">No reply yet.</p>;
  return (
    <ul className="bk-mb">
      {history.map((e) => (
        <li key={e.id}><Badge tone={replyTone(e)}>{replyLabel(e, options)}</Badge> {fmtDateTime(e.at)}, {replyBy(e)}{e.comment ? <>: &ldquo;{e.comment}&rdquo;</> : null}</li>
      ))}
    </ul>
  );
}

// A CRM user records the client's or lead's reply. A chosen or accepted option is set on the proposal, as the client's choice in the portal is.
export function ProposalReplyDialog({ quote, history, onClose, onDone }) {
  const options = quote.field_values?.proposal?.options || [];
  const current = quote.field_values?.proposal?.accepted_option;
  const issued = quote.status === "issued";
  const [kind, setKind] = useState(issued ? (options.length > 1 ? "option" : "accepted") : "comment");
  const [option, setOption] = useState(current === null || current === undefined ? (options.length === 1 ? "0" : "") : String(current));
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const needsOption = kind === "option" || kind === "accepted";
  const submit = async (e) => {
    e.preventDefault();
    const problem = replyProblem(kind, option, comment, options.length);
    if (problem) return setError(problem);
    setBusy(true); setError(null);
    try {
      const r = await recordProposalReply({ quote_id: quote.id, kind, option: needsOption && option !== "" ? Number(option) : null, comment: comment.trim() || null });
      await onDone(`${replyLabel(r, options)} recorded on ${quote.document_number}.`);
    } catch (err) { setError(err.message); }
    setBusy(false);
  };
  return (
    <Modal title={`Client's reply to ${quote.document_number}`} onClose={onClose} wide>
      <form onSubmit={submit}>
        <ErrorNote message={error} onClose={() => setError(null)} />
        <ReplyHistory history={history} options={options} />
        <fieldset className="bk-field bk-full">
          <legend>Reply <em>*</em></legend>
          {KINDS.filter(([k]) => issued || k === "comment").filter(([k]) => k !== "option" || options.length > 1).map(([k, label]) => (
            <label key={k} className="bk-check"><input type="radio" name="reply-kind" value={k} checked={kind === k} onChange={() => setKind(k)} /> {label}</label>
          ))}
        </fieldset>
        {needsOption && options.length > 1 && (
          <fieldset className="bk-field bk-full">
            <legend>Option <em>*</em></legend>
            {options.map((o, i) => (
              <label key={i} className="bk-check"><input type="radio" name="reply-option" value={String(i)} checked={option === String(i)} onChange={(e) => setOption(e.target.value)} /> Option {i + 1}: {o.authority_name || o.authority_key}, {o.activity}, AED {plain(optionTotal(o))}</label>
            ))}
          </fieldset>
        )}
        <div className="bk-field bk-full"><label htmlFor="reply-comment">Comment{kind === "comment" && <em> *</em>}</label>
          <textarea id="reply-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} /></div>
        <p className="bk-note">
          {!issued ? `This proposal is ${quote.status}: only a comment can be added.` : "A chosen or accepted option is set on the proposal, and can change while it is issued."}
          {!quote.client_id ? " This proposal has no client yet: the reply is recorded for the lead. Formal acceptance needs a client." : " Formal acceptance is still the client's Accept in the portal, or the signed copy confirmed in Quotes & Agreements."}
        </p>
        <div className="bk-modal-actions"><Button onClick={onClose}>Cancel</Button><Button type="submit" variant="primary" busy={busy}>Record reply</Button></div>
      </form>
    </Modal>
  );
}

// Every option of every shared proposal with the client's reply. proposals: the proposal rows; activity: { replies, decisions }.
export default function SharedProposals({ proposals, activity, onReply, error }) {
  const rows = sharedOptionRows(proposals);
  const historyOf = (d) => replyHistory(d.id, activity?.replies, activity?.decisions);
  const optionReply = (r) => {
    const s = replyState(r.doc, historyOf(r.doc));
    const mine = s.chosen === r.index;
    if (s.latest?.decision) return mine || r.count === 1 ? <Badge tone={replyTone(s.latest)}>{replyLabel(s.latest)}</Badge> : <span className="bk-muted">Not chosen</span>;
    if (s.latest?.kind === "declined") return <Badge tone="bad">Declined</Badge>;
    if (mine) return <Badge tone={s.latest?.kind === "accepted" ? "good" : "warn"}>{s.latest?.kind === "accepted" ? "Accepted" : "Chosen"}</Badge>;
    return s.chosen === null ? <span className="bk-muted">Waiting</span> : <span className="bk-muted">Not chosen</span>;
  };
  const via = (d) => sharedVia(d).map((w) => (w === "mail" ? `Mailed ${fmtDate(d.mail_sent_at)}` : "Client portal")).join(", ");
  return (
    <Panel title="Shared proposals and replies" sub="Every option sent to a client or lead, with the client's reply. The client replies in the Client Portal, or record it here: both go on the same proposal.">
      <ErrorNote message={error} />
      <DataTable search="Search…" rows={rows} empty="No proposal has been shared yet. A proposal shows here once it is mailed, or once it has a client (it is then in the Client Portal)." columns={[
        { key: "ref", label: "Ref", render: (r) => r.doc.document_number },
        { key: "client", label: "Client or lead", render: (r) => <>{r.doc.client_name}{!r.doc.client_id && <> <Badge>Lead</Badge></>}</> },
        { key: "option", label: "Option", render: (r) => `${r.index + 1}: ${r.option.authority_name || r.option.authority_key}, ${r.option.activity}` },
        { key: "total", label: "AED", right: true, render: (r) => plain(optionTotal(r.option)) },
        { key: "shared", label: "Shared", render: (r) => (r.first ? via(r.doc) : "") },
        { key: "reply", label: "Reply", render: optionReply },
        { key: "comment", label: "Latest comment", render: (r) => { if (!r.first) return ""; const c = replyState(r.doc, historyOf(r.doc)).comment; return c ? <span title={fmtDateTime(c.at)}>&ldquo;{c.comment}&rdquo; <small className="bk-muted">{replyBy(c)}</small></span> : ""; } },
        { key: "act", label: "", render: (r) => (r.first ? <Button onClick={() => onReply(r.doc)}>{replyState(r.doc, historyOf(r.doc)).count ? "Update reply" : "Record reply"}</Button> : "") },
      ]} />
    </Panel>
  );
}
