// node --test "HR Module/tests/"   (run from the repo root; no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { expiryBand, bandLabel } from "../logic/expiry.js";

const TODAY = "2026-11-01";

test("expired the day after it lapses", () => assert.equal(expiryBand("2026-10-31", TODAY), "expired"));
test("a document expiring today is not expired yet", () => assert.equal(expiryBand("2026-11-01", TODAY), "30"));
test("today + 30 is the 30 band", () => assert.equal(expiryBand("2026-12-01", TODAY), "30"));
test("today + 31 is the 60 band", () => assert.equal(expiryBand("2026-12-02", TODAY), "60"));
test("today + 60 is the 60 band", () => assert.equal(expiryBand("2026-12-31", TODAY), "60"));
test("today + 61 is the 90 band", () => assert.equal(expiryBand("2027-01-01", TODAY), "90"));
test("today + 90 is the 90 band", () => assert.equal(expiryBand("2027-01-30", TODAY), "90"));
test("today + 91 has no band", () => assert.equal(expiryBand("2027-01-31", TODAY), null));
test("no date has no band", () => {
  assert.equal(expiryBand(null, TODAY), null);
  assert.equal(expiryBand("", TODAY), null);
  assert.equal(expiryBand(undefined, TODAY), null);
});
test("a bad date has no band", () => assert.equal(expiryBand("not a date", TODAY), null));
test("month and year boundaries use calendar days", () => {
  assert.equal(expiryBand("2027-03-01", "2027-01-30"), "30"); // Jan 30 + 30 days = Mar 1 (28-day February)
  assert.equal(expiryBand("2027-03-02", "2027-01-30"), "60");
});
test("labels", () => {
  assert.equal(bandLabel("expired"), "Expired");
  assert.equal(bandLabel("30"), "Within 30 days");
  assert.equal(bandLabel(null), "");
});
