// Tracker statuses, in the order staff move through them. Completed is set by completing the service, with its output.
export const SERVICE_STATUSES = ["Not started", "In progress", "Waiting on client", "Waiting on government", "Completed", "Cancelled"];
export const statusTone = (s) => ({ Completed: "good", Cancelled: "bad", "Waiting on client": "warn", "Waiting on government": "warn" }[s]);
export const quoteTone = (s) => ({ accepted: "good", rejected: "bad", superseded: undefined, issued: "warn" }[s]);

// Props for the Zoho panel on a quote. It shows for issued and accepted quotes so Zoho changes
// after handover can still be read. A held quote is read-only; the invoice needs a ready, accepted one.
export function zohoProps(status, { quotes, held, ready, invoiceRight, known = true }) {
  const open = !held && (status === "issued" || known);
  return {
    kinds: status === "accepted" ? ["estimate", "invoice"] : ["estimate"],
    canCreate: { estimate: !!quotes && open, invoice: status === "accepted" && !!ready && !held && !!invoiceRight },
  };
}

// Badge tone of a case stage.
export const STAGE_TONE = { Lost: "bad", Lead: "warn", Review: "warn", Onboarding: "warn", Completion: "warn", "With Accounts": "warn", Completed: "good", Cancelled: "bad" };
