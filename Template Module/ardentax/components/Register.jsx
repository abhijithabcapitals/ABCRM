// Every quotation and engagement letter generated in the tab, newest first. Replaces the workbook's Quote Log.
import { Badge, Button, DataTable, fmtDate } from "@banking/components/shared";
import { signState, signStatus } from "../logic/signingUi.js";

const aed = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

// canSign: the user is an Ardentax approver (doc_sign_can). Each row carries signing = { live, last }. Signing is optional.
export default function Register({ docs, docType, busy, canSign = false, onOpen, onAgain, onLetter, onRevise, onMail, onSign }) {
  // A quote's number has one letter, whichever version of the quote it came from.
  const hasLetter = (q) => docs.some((d) => d.doc_type === "letter" && docs.some((s) => s.id === d.source_quote_id && s.document_number === q.document_number));
  const latestOf = (d) => !docs.some((x) => x.document_number === d.document_number && x.version > d.version);
  return (
    <DataTable
      search="Search by number or client…"
      rows={docType ? docs.filter((d) => d.doc_type === docType) : docs}
      empty="Nothing generated yet."
      columns={[
        { key: "document_number", label: "Number", render: (d) => <span>{d.document_number}{d.version > 1 ? ` v${d.version}` : ""}</span> },
        { key: "doc_type", label: "Type", render: (d) => <Badge>{d.doc_type === "quote" ? "Quotation" : "Engagement Letter"}</Badge> },
        { key: "client_name", label: "Client" },
        { key: "selected_package", label: "Package" },
        { key: "volume", label: "Invoices", right: true, render: (d) => aed(d.volume) },
        { key: "annual", label: "Annual", right: true, render: (d) => aed(d.annual) },
        { key: "year1_total", label: "Year 1", right: true, render: (d) => aed(d.year1_total) },
        { key: "created_at", label: "Date", render: (d) => fmtDate(d.created_at) },
        { key: "created_by_name", label: "Created by", render: (d) => d.created_by_name || "–" },
        { key: "files", label: "Files", render: (d) => (d.word_path
          ? <span className="at-actions"><button type="button" className="bk-link" onClick={() => onOpen(d.word_path)}>Word</button><button type="button" className="bk-link" onClick={() => onOpen(d.pdf_path)}>PDF</button></span>
          : <span className="at-actions"><Badge tone="warn">File pending</Badge><Button busy={busy === `again-${d.id}`} disabled={!!busy} onClick={() => onAgain(d)}>Generate again</Button></span>) },
        { key: "signature", label: "Signature", render: (d) => {
          const g = signStatus(d.signing, fmtDate);
          const s = signState(d, { canSign, signing: d.signing });
          return (
            <span className="at-actions">
              <Badge tone={g.tone}>{g.label}</Badge>
              {s.signedPdf && <button type="button" className="bk-link" onClick={() => onOpen(s.signedPdf)}>Signed PDF</button>}
              {s.sign && <Button busy={busy === `sign-${d.id}`} disabled={!!busy} onClick={() => onSign(d)}>Sign</Button>}
            </span>
          );
        } },
        { key: "mail", label: "Email", render: (d) => (d.mail_sent_at ? <button type="button" className="bk-link" onClick={() => onMail(d)}>Sent {fmtDate(d.mail_sent_at)}</button> : <button type="button" className="bk-link" onClick={() => onMail(d)}>Draft</button>) },
        { key: "next", label: "Next", render: (d) => (
          <span className="at-actions">
            {d.doc_type === "quote" && d.word_path && !hasLetter(d) && latestOf(d) && <Button busy={busy === `letter-${d.id}`} disabled={!!busy} onClick={() => onLetter(d)}>Make Engagement Letter</Button>}
            {latestOf(d) && <Button disabled={!!busy} onClick={() => onRevise(d)}>Revise</Button>}
          </span>
        ) },
      ]}
    />
  );
}
