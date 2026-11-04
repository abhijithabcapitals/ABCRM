// A client login's username and password, as the staff screens suggest them.
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePassword(length = 14) {
  const limit = 256 - (256 % ALPHABET.length);
  let out = "";
  while (out.length < length) for (const b of crypto.getRandomValues(new Uint8Array(32))) if (b < limit && out.length < length) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export const suggestUsername = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "").slice(0, 40);
