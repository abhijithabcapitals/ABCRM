// Errors the zoho-finance function shows to the browser.
import { isRateLimit, ZohoAccessError, ZohoHttpError, ZohoTimeoutError } from "./zohoClient.ts";

export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

// The stored texts that mean Zoho was limiting requests. A forced refresh waits longer after one of them, so the
// Dashboard's copy of this list (refreshWaitMinutes in summaryFigures.js) must hold the same texts.
export const BUSY_MESSAGE = "Zoho is busy, try again shortly.";
export const BUSY_PARTIAL = "Zoho is limiting requests, so some figures are incomplete. Refresh again in a few minutes.";
export const BUSY_KEPT = "Zoho is limiting requests. Refresh again in a few minutes.";
export const RATE_LIMIT_MESSAGES = [BUSY_MESSAGE, BUSY_PARTIAL, BUSY_KEPT];

// The only error text the browser sees for a Zoho or unexpected failure. Raw detail stays in the server log.
export function browserMessage(e: unknown): string {
  if (e instanceof ZohoAccessError) return "Zoho access has stopped. An admin must reconnect.";
  if (e instanceof ZohoTimeoutError) return "Zoho did not answer in time, try again shortly.";
  if (e instanceof ZohoHttpError) {
    return isRateLimit(e) ? BUSY_MESSAGE : "Zoho refused the request.";
  }
  return "Something went wrong talking to Zoho.";
}
