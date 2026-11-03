// Client-facing view of a banking case: the 15 visible steps as a percent, or the final outcome.
import { STAGES, uiStep } from "../../Banking Module/logic/constants.js";

// Case outcomes that end the work with no account opened. Plain labels, no percent.
const DEAD = { Returned: "Returned", Cancelled: "Cancelled", Closed: "Closed" };

export function bankingProgress({ current_stage, outcome }) {
  if (outcome === "Approved") return { state: "approved", percent: 100, label: "Account opened" };
  if (outcome === "Rejected") return { state: "rejected", percent: null, label: "Not approved" };
  if (DEAD[outcome]) return { state: "closed", percent: null, label: DEAD[outcome] };
  const step = uiStep(current_stage);
  return { state: "open", percent: Math.round((step / 15) * 100), label: STAGES[step - 1] };
}

// A Cancelled or Returned case is not owed any more, so a balance would read as a debt: show what was paid only.
export const hidesBalance = (outcome) => outcome === "Cancelled" || outcome === "Returned";
