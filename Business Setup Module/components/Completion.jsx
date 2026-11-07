// Completion: cases whose services are finished and wait for the department admin, and cases Accounts is validating.
// Each row shows the money: quote total, net paid, balance, invoices and pending payment claims. An unpaid balance shows and does not block.
import { useState } from "react";
import { Badge, Button, DataTable, ErrorNote, FormModal, Modal, PageHead, Spinner, fmtDate, useLoad } from "@banking/components/shared";
import { useSetup } from "./SetupContext";
import ClosedCases from "./ClosedCases";
import { caseDocuments, caseList, handoverState, sendToAccounts } from "../services/businessSetupApi";
import { STAGE_TONE } from "../logic/statuses";
import { caseBalance } from "../logic/progress";
import { aedMoney as money } from "@app/money";
import { supabase } from "@app/supabase";
import { callZoho } from "@integrations/logic/zohoPanel";

const SEND_LABEL = "Invoice and send to Accounts";

// Creates the Zoho invoice for the accepted quote. Zoho returns the existing one when it was already made, so a retry never duplicates it.
async function createInvoice(quoteId) {
  const out = await callZoho(supabase, { action: "document_create", source_table: "hub_documents", source_id: quoteId, kind: "invoice" });
  if (out?.needs_contact) throw new Error("Link this client's Zoho contact first: Open client, Quotes & Agreements, Show Zoho details. Then try again.");
  if (out?.state && out.state !== "created") throw new Error("Zoho did not confirm the invoice. Wait 2 minutes, then try again.");
  return out;
}

export default function Completion() {
  const { can, goTo } = useSetup();
  const list = useLoad(() => caseList("completion"), []);
  const [sending, setSending] = useState(null);
  return (
    <div>
      <PageHead title="Completion" sub="Cases with every service finished. Send one to Accounts to close it; Accounts validates it or reverts it with remarks." />
      <ErrorNote message={list.error} />
      {list.loading && !list.data ? <Spinner /> : (
        <DataTable rows={list.data || []} search="Search case or client…" empty="No cases at Completion." columns={[
          { key: "case_number", label: "Case" }, { key: "client_name", label: "Client", render: (c) => c.client_name || c.lead_name || "–" },
          { key: "stage", label: "State", render: (c) => <Badge tone={STAGE_TONE[c.stage]}>{c.stage}</Badge> },
          { key: "quote_total", label: "Quote", right: true, render: (c) => (c.quote_total == null ? "–" : money(c.quote_total)) },
          { key: "net_paid", label: "Net paid", right: true, render: (c) => money(c.net_paid || 0) },
          { key: "balance", label: "Balance", right: true, render: (c) => { const b = caseBalance(c); return b == null ? "–" : b > 0 ? <Badge tone="warn">{money(b)}</Badge> : money(b); } },
          { key: "invoices", label: "Invoices", right: true, render: (c) => c.invoices ?? 0 },
          { key: "claims_pending", label: "Claims", render: (c) => (c.claims_pending ? <Badge tone="warn">{c.claims_pending} pending</Badge> : "") },
          { key: "owner_name", label: "Owner", render: (c) => c.owner_name || "–" }, { key: "updated_at", label: "Updated", render: (c) => fmtDate(c.updated_at) },
          { key: "x", label: "", render: (c) => (
            <span className="bk-actions bk-wrap">
              {c.client_id && <Button onClick={() => goTo("clients", { client: c.client_id })}>Open client</Button>}
              {c.stage === "Completion" && can("setup.cases.approve") && <Button variant="primary" onClick={() => setSending(c)}>{SEND_LABEL}</Button>}
            </span>
          ) },
        ]} />
      )}
      <ClosedCases refreshKey={list.data} />
      {sending &&<SendDialog c={sending} onClose={() => setSending(null)} onDone={list.reload} />}
    </div>
  );
}

// Finds the case's accepted quote, shows what still blocks the handover, creates the Zoho invoice, then sends it with remarks.
// The invoice comes first: if Zoho refuses, nothing is sent and the case stays at Completion.
function SendDialog({ c, onClose, onDone }) {
  const found = useLoad(async () => {
    const quote = (await caseDocuments(c.id)).find((d) => d.doc_type === "quote" && d.status === "accepted");
    if (!quote) throw new Error("This case has no accepted quote to send.");
    return { quote, state: await handoverState(quote.id) };
  }, [c.id]);
  const h = found.data?.state;
  if (found.loading && !found.data) return <Modal title={`Invoice and send ${c.case_number} to Accounts`} onClose={onClose}><Spinner /></Modal>;
  if (!found.data || !h?.ready) {
    return (
      <Modal title={`Invoice and send ${c.case_number} to Accounts`} onClose={onClose}>
        <ErrorNote message={found.error} />
        {h && <p className="bk-note">To invoice and send to Accounts: {(h.blockers || []).join(", ") || "not ready"}.</p>}
        <div className="bk-modal-actions"><Button onClick={onClose}>Close</Button></div>
      </Modal>
    );
  }
  return (
    <FormModal title={`Invoice and send ${c.case_number} to Accounts`} submitLabel="Invoice and send"
      note={`Net paid ${money(h.net_paid)}. A Zoho invoice is created for the accepted quote first. This case, its services and payments cannot change while Accounts holds it.`}
      fields={[{ name: "remarks", label: "Remarks for Accounts", type: "textarea", full: true }]} onClose={onClose}
      onSubmit={async (v) => { await createInvoice(found.data.quote.id); await sendToAccounts(found.data.quote.id, v.remarks); await onDone(); }} />
  );
}
