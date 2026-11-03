// How an expiry reads on screen. Imported dates may be stale, so a past date asks staff to check it rather than saying it lapsed.
export const expiryNote = (e) => (e.state === "Past date" ? "Check this date" : "Upcoming");
