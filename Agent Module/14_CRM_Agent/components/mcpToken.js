const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// 32 random bytes as 64 hex characters. Only the SHA-256 hash is sent to the database.
export async function createMcpToken() {
  const token = toHex(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return { token, hash: toHex(new Uint8Array(digest)), headerValue: `Bearer ${token}` };
}
