// Tracker statuses, in the order staff move through them. Completed is set by completing the service, with its output.
export const SERVICE_STATUSES = ["Not started", "In progress", "Waiting on client", "Waiting on government", "Completed", "Cancelled"];
export const statusTone = (s) => ({ Completed: "good", Cancelled: "bad", "Waiting on client": "warn", "Waiting on government": "warn" }[s]);
export const quoteTone = (s) => ({ accepted: "good", rejected: "bad", superseded: undefined, issued: "warn" }[s]);
