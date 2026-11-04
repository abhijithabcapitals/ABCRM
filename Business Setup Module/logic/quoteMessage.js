// The message that goes with a quote: where to sign in and which login to use. The password is never part of it: staff send it
// separately with the password email, because only an admin can read a stored password and each view is logged.
export function quoteMessage({ contact, number, url, username }) {
  const name = String(contact || "").replace(/[\r\n]+/g, " ").trim();
  return [
    `Dear ${name || "Sir or Madam"},`,
    "",
    `Please find our quote ${number || ""} attached. To accept it, sign the quote and upload the signed copy in the AB Capital client portal.`,
    "",
    `Portal: ${url}`,
    `Login ID: ${username}`,
    "",
    "Your password is sent to you in a separate email. If you need it again, contact AB Capital.",
    "",
    "Regards,",
    "AB Capital",
  ].join("\n");
}

// What the quote message area shows. A failed load is not the same as a client with no login.
export function messageState({ loading, error, login }) {
  if (error) return "error";
  if (loading && !login) return "loading";
  return login ? "ready" : "nologin";
}
// A payment amount the database will take: above zero, two decimals at most. Checked before a client is created for a payment.
export const validAmount = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6; };
