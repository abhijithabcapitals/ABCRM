// Client-facing view of a banking case: the 15 visible steps as a percent, or the final outcome.
import { STAGES, uiStep } from "../../Banking Module/logic/constants.js";

export function bankingProgress({ current_stage, outcome }) {
  if (outcome === "Approved") return { state: "approved", percent: 100, label: "Account opened" };
  if (outcome === "Rejected") return { state: "rejected", percent: null, label: "Not approved" };
  const step = uiStep(current_stage);
  return { state: "open", percent: Math.round((step / 15) * 100), label: STAGES[step - 1] };
}
