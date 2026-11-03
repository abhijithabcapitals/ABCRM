// Status helpers. `today` is a Dubai date string (YYYY-MM-DD); these functions never read the clock.
export const isExpired = (validUntil, today) => Boolean(validUntil) && validUntil < today;

// Draft, Internal or Low confidence items need an admin's attention. Entries have no confidence.
export const needsReview = (item) => item.status === "Draft" || item.visibility === "Internal" || item.confidence === "Low";
