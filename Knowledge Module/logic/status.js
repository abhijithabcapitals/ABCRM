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

// A group of price lines is copied through its Shareable lines only, so the copy rules follow those lines.
// Shareable if any line is; Draft if any Shareable line is Draft (the confirm tick is then required).
export function groupCopyItem(lines) {
  const shareable = lines.filter((l) => l.visibility === "Shareable");
  return {
    visibility: shareable.length ? "Shareable" : "Internal",
    status: shareable.some((l) => l.status === "Draft") ? "Draft" : "Approved",
  };
}

// Status shown on a group card: Draft if any line in the group is Draft, whatever its visibility.
// The copy tick follows groupCopyItem instead.
export const groupDisplayStatus = (lines) => (lines.some((l) => l.status === "Draft") ? "Draft" : "Approved");
