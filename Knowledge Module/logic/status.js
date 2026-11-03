// Status helpers. `today` is a Dubai date string (YYYY-MM-DD); these functions never read the clock.
export const isExpired = (validUntil, today) => Boolean(validUntil) && validUntil < today;

// Draft, Internal or Low confidence items need an admin's attention. Entries have no confidence.
export const needsReview = (item) => item.status === "Draft" || item.visibility === "Internal" || item.confidence === "Low";

// A blocked or unmatched update returns no error and fewer rows than asked for. Throws unless every id came back.
export function assertAllUpdated(rows, ids, action) {
  const wanted = [].concat(ids).length;
  const done = rows?.length ?? 0;
  if (done !== wanted) throw new Error(`${action} ${done} of ${wanted} rows (not permitted or not found)`);
  return rows;
}
