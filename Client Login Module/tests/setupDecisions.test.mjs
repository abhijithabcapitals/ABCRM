// node --test "Client Login Module/tests/setupDecisions.test.mjs"   (no extra packages)
// The client's acceptance and payment claim rules as the screens apply them. The server repeats every rule; these only spare a round trip.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { claimProblem, decisionProblem, invoiceClaimState, proofProblem } from "../logic/decisions.js";

const read = (f) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");

test("a rejection needs a note, an acceptance does not", () => {
  assert.equal(decisionProblem("Rejected", "   "), "Tell us why you are rejecting this document.");
  assert.equal(decisionProblem("Rejected", ""), "Tell us why you are rejecting this document.");
  assert.equal(decisionProblem("Rejected", "Price too high"), null);
  assert.equal(decisionProblem("Accepted", ""), null);
  assert.equal(decisionProblem("Maybe", "x"), "Choose Accept or Reject.");
});

test("a claim needs an amount above zero with at most two decimals, and a date that is not in the future", () => {
  const ok = { amount: "300.50", paid_on: "2026-11-04" };
  assert.equal(claimProblem(ok, "2026-11-05"), null);
  assert.equal(claimProblem({ ...ok, paid_on: "2026-11-05" }, "2026-11-05"), null);
  for (const amount of ["", "0", "-5", "abc", "10.123", "1e3"]) assert.equal(claimProblem({ ...ok, amount }, "2026-11-05"), "Enter an amount above zero with at most two decimals.", amount);
  assert.equal(claimProblem({ ...ok, paid_on: "" }, "2026-11-05"), "Enter the date you paid.");
  assert.equal(claimProblem({ ...ok, paid_on: "2026-11-06" }, "2026-11-05"), "The payment date cannot be in the future.");
  assert.equal(claimProblem({ ...ok, reference: "x".repeat(201) }, "2026-11-05"), "The reference is too long.");
});

test("a proof of payment is a PDF, JPG or PNG of at most 10 MB, and is optional", () => {
  assert.equal(proofProblem(null), null);
  assert.equal(proofProblem({ name: "slip.PDF", size: 10 * 1024 * 1024 }), null);
  assert.equal(proofProblem({ name: "slip.jpeg", size: 1 }), null);
  assert.equal(proofProblem({ name: "slip.png", size: 1 }), null);
  assert.equal(proofProblem({ name: "slip.docx", size: 1 }), "Upload the proof of payment as a PDF, JPG or PNG file.");
  assert.equal(proofProblem({ name: "slip", size: 1 }), "Upload the proof of payment as a PDF, JPG or PNG file.");
  assert.equal(proofProblem({ name: "slip.pdf", size: 10 * 1024 * 1024 + 1 }), "The proof of payment must be under 10 MB.");
  assert.equal(proofProblem({ name: "slip.pdf", size: 0 }), "The proof of payment must be under 10 MB.");
});

test("an invoice with a Pending claim shows that state, not a button", () => {
  const inv = { id: "i1", can_claim: true, claim_pending: false };
  const claims = [{ id: "c2", invoice_id: "i1", status: "Refused", note: "No match" }, { id: "c1", invoice_id: "i2", status: "Pending" }];
  assert.deepEqual(invoiceClaimState(inv, claims), { state: "open", last: claims[0] });
  assert.equal(invoiceClaimState({ ...inv, claim_pending: true, can_claim: false }, [{ id: "c3", invoice_id: "i1", status: "Pending" }]).state, "pending");
  assert.equal(invoiceClaimState({ ...inv, can_claim: false }, []).state, "closed");
  assert.deepEqual(invoiceClaimState(inv, []), { state: "open", last: null });
});

test("the portal screens call the actions with the session only, and import nothing from staff code", () => {
  const api = read("../portal/portalApi.js");
  assert.match(api, /setupDecide: .*call\("setup_decide"/s);
  assert.match(api, /setupClaim: .*call\("setup_payment_claim"/s);
  assert.match(api, /for_claim: true/);
  assert.doesNotMatch(api, /account_id|client_id/);
  for (const f of ["SetupView.jsx", "DecisionPanel.jsx", "ClaimForm.jsx", "ProposalsPanel.jsx"]) {
    const s = read(`../portal/${f}`);
    for (const m of s.matchAll(/from "(@[^"]+)"/g)) assert.ok(["@banking/components/shared", "@business-setup/logic/formDefinition"].includes(m[1]), `${f} imports ${m[1]}`);
    assert.doesNotMatch(s, /staffCall|staffPost|admin_/, `${f} reaches for a staff action`);
  }
});

test("the view shows Accept and Reject on quotes and letters, a Reject note box, and I have paid on invoices", () => {
  const v = read("../portal/SetupView.jsx");
  assert.match(v, /DecisionPanel/); assert.match(v, /ClaimForm/);
  assert.match(v, /can_decide/); assert.match(v, /can_claim|invoiceClaimState/);
  assert.match(read("../portal/DecisionPanel.jsx"), /Accept/); assert.match(read("../portal/DecisionPanel.jsx"), /Reject/);
  assert.match(read("../portal/ClaimForm.jsx"), /I have paid/);
});

test("Send in the decision and claim screens is guarded by a ref, so a fast double click sends once", () => {
  for (const f of ["../portal/DecisionPanel.jsx", "../portal/ClaimForm.jsx"]) {
    const s = read(f);
    assert.match(s, /import \{ useRef, useState \} from "react"/, f);
    assert.match(s, /const sending = useRef\(false\)/, f);
    const send = s.slice(s.indexOf("const send = async"), s.indexOf("return (", s.indexOf("const send = async")));
    assert.ok(send.indexOf("if (sending.current) return;") > -1 && send.indexOf("sending.current = true") > send.indexOf("if (sending.current) return;"), f);
    // The guard is set before the first await and cleared after the try and catch have run.
    assert.ok(send.indexOf("sending.current = true") < send.indexOf("await "), f);
    assert.ok(send.lastIndexOf("sending.current = false") > send.indexOf("catch"), f);
  }
});

test("Accept and I have paid open as a pop-up, because their buttons sit far down the page", () => {
  for (const f of ["../portal/DecisionPanel.jsx", "../portal/ClaimForm.jsx"]) {
    assert.match(read(f), /<Modal title=/, f);
    assert.doesNotMatch(read(f), /<Panel/, f);
  }
});

test("until the Terms are agreed, the server opens only reading them, agreeing and signing out, before any client action", () => {
  const i = read("../supabase/client-portal/index.ts");
  assert.match(i, /TERMS_OPEN_ACTIONS = \["logout", "terms_get", "terms_accept"\]/);
  assert.ok(i.indexOf("TERMS_OPEN_ACTIONS.includes(action)") > i.indexOf('client_portal_session"'));
  assert.ok(i.indexOf("TERMS_OPEN_ACTIONS.includes(action)") < i.indexOf("switch (action)"));
  assert.match(i, /terms_required: true \}, 403/);
  // The account comes from the session, never the request.
  assert.match(i, /client_portal_terms_accept", \{ p_account: accountId, p_terms: termsId \}/);
});

test("the Terms screen needs the tick, shows plain text and imports no staff code", () => {
  const g = read("../portal/TermsGate.jsx");
  assert.match(g, /disabled=\{!ticked\}/);
  assert.doesNotMatch(g, /dangerouslySetInnerHTML/);
  assert.doesNotMatch(g, /@client-login\/admin|\.\.\/admin|supabase/);
  const p = read("../portal/ClientPortal.jsx");
  assert.ok(p.indexOf("terms.data.required") < p.indexOf("<PortalScreen"));
  assert.match(p, /readOnly \? Promise\.resolve\(\{ required: false \}\)/);
});

test("the client's proposals: every option, a choice or comment through proposal_reply, Accept and Decline through the decision panel", () => {
  const api = read("../portal/portalApi.js");
  assert.match(api, /proposals: .*call\("proposals"\)/s);
  assert.match(api, /proposalReply: .*call\("proposal_reply"/s);
  const p = read("../portal/ProposalsPanel.jsx");
  assert.match(p, /p\.options/); assert.match(p, /can_reply/); assert.match(p, /proposalReply/);
  assert.match(p, /onDecide\(doc, "Accepted"\)/); assert.match(p, /onDecide\(doc, "Rejected"\)/);
  assert.match(read("../portal/SetupView.jsx"), /<ProposalsPanel/);
  const fn = read("../supabase/client-portal/index.ts");
  assert.ok(fn.indexOf('case "proposal_reply":') > fn.indexOf('"client_portal_session"'), "proposal_reply runs after the session check");
  const b = fn.slice(fn.indexOf('case "proposal_reply":'), fn.indexOf('case "setup_payment_claim":'));
  assert.match(b, /p_account: accountId/); assert.doesNotMatch(b, /body\.(account|client)/);
});
