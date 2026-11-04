import test from "node:test";
import assert from "node:assert/strict";
import { cleanNews, newsAuthor, newsLine, newsSeconds } from "../src/news.js";

test("a headline names its author, then their email, then a fallback", () => {
  assert.equal(newsAuthor({ author: { full_name: "Mo", email: "m@x" } }), "Mo");
  assert.equal(newsAuthor({ author: { email: "m@x" } }), "m@x");
  assert.equal(newsAuthor({ author: null }), "Former colleague");
  assert.equal(newsLine({ author: { full_name: "Mo" }, message: "Hello" }), "Mo: Hello");
});
test("a message is tidied to one line and blank stays blank", () => {
  assert.equal(cleanNews("  Office\n closed   Friday "), "Office closed Friday");
  assert.equal(cleanNews("   "), "");
  assert.equal(cleanNews(null), "");
});
test("headlines scroll slowly enough to read", () => {
  assert.equal(newsSeconds([{ message: "Hi" }]), 15);
  assert.equal(newsSeconds([{ author: { full_name: "Mo" }, message: "x".repeat(596) }]), 50);
});
