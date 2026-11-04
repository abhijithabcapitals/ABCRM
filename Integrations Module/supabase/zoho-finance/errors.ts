// Errors the zoho-finance function shows to the browser.
import { ZohoAccessError, ZohoHttpError } from "./zohoClient.ts";

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

// The only error text the browser sees for a Zoho or unexpected failure. Raw detail stays in the server log.
export function browserMessage(e: unknown): string {
  if (e instanceof ZohoAccessError) return "Zoho access has stopped. An admin must reconnect.";
  if (e instanceof ZohoHttpError) {
    return e.status === 429 ? "Zoho is busy, try again shortly." : "Zoho refused the request.";
  }
  return "Something went wrong talking to Zoho.";
}
