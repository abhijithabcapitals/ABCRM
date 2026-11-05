// A client login's username and password, generated on the server for the login issued with a quote (client-portal, setup_issue_login).
// Same rules as Business Setup Module/logic/loginSecret.js, which the staff screens use to suggest them: tests/setupIssueLogin.test.mjs checks they agree.
// The password never leaves the function that generates it except by email and into the vault copy.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 14): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) for (const b of crypto.getRandomValues(new Uint8Array(32))) if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const suggestUsername = (name: string): string => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 40);

// The usernames to try, in order: the suggestion from the client's name (padded with the client id when it is too short for the database rule,
// 4 to 60 letters, numbers, dots, dashes or underscores), then the same with a number after it.
export function usernameCandidates(name: string, clientId: string, tries = 6): string[] {
  let base = suggestUsername(name);
  if (base.length < 4) base = suggestUsername(`${base} ${clientId}`);
  if (base.length < 4) base = "client";
  const out = [base];
  for (let i = 2; out.length < tries; i++) out.push(`${base.slice(0, 37)}.${i}`);
  return out;
}
