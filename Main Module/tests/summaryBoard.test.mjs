// Static checks on the summary board: no network, database or browser needed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const components = fileURLToPath(new URL("../../Dashboard Module/components/", import.meta.url));
const read = (name) => readFileSync(join(components, name), "utf8");

test("summary styles switch motion off for people who ask for it", () => {
  assert.match(read("summary.css"), /prefers-reduced-motion/);
});

test("Dashboard renders the board outside the empty state, inside content-area", () => {
  const src = read("Dashboard.jsx");
  const close = src.indexOf(") : null}", src.indexOf("total === 0"));
  const board = src.indexOf("<SummaryBoard");
  assert.ok(close > 0, "the total === 0 expression should end with ) : null}");
  assert.ok(board > close, "SummaryBoard should come after the total === 0 expression");
  assert.ok(src.indexOf('className="content-area"') < board, "SummaryBoard should come after the content-area opening");
  assert.ok(!src.slice(close, board).includes("</div>"), "SummaryBoard should sit before content-area closes");
});

test("no animation or drag library is imported", () => {
  const files = readdirSync(components, { recursive: true }).filter((f) => /\.jsx?$/.test(f));
  assert.ok(files.includes("SummaryBoard.jsx"), "SummaryBoard.jsx should exist");
  for (const f of files) {
    assert.doesNotMatch(read(f), /from\s+["'](framer-motion|react-dnd|@dnd-kit)/, f);
  }
});

test("a body that throws stays inside its card, and Retry remounts it", () => {
  const src = read("SummaryCard.jsx");
  assert.match(src, /getDerivedStateFromError/);
  assert.match(src, /<BodyBoundary\s+key=\{attempt\}/);
  assert.ok(src.indexOf("<BodyBoundary") < src.indexOf("<RenderBody"), "the render function should run inside the boundary");
});

test("a step returns keyboard focus to a move button, falling back when it is disabled", () => {
  const src = read("SummaryBoard.jsx");
  assert.match(src, /refocus\.current/);
  assert.match(src, /\.disabled/);
  assert.match(src, /\.focus\(/);
});

const repo = fileURLToPath(new URL("../../", import.meta.url));

test("Dashboard only starts the Zoho read and refresh when the cards are live", () => {
  const src = read("Dashboard.jsx");
  assert.match(src, /import \{ ZOHO_CARDS_LIVE \} from "\.\.\/logic\/summaryLayout\.js"/);
  assert.match(src, /useZohoFinance\(isAdmin && ZOHO_CARDS_LIVE\)/);
});

test("every layout save on the board waits for the tabs", () => {
  const src = read("SummaryBoard.jsx");
  const saves = src.match(/saveLayout\(userId/g) || [];
  const guarded = src.match(/if \(saveAllowed\) saveLayout\(userId/g) || [];
  assert.ok(saves.length >= 2, "the board should save the layout");
  assert.equal(guarded.length, saves.length);
  assert.match(src, /if \(saveAllowed\) clearLayout\(userId\)/);
});

test("the Accounting and Tax cards read past the 1,000 row cap, with a stable order", () => {
  const src = readFileSync(join(repo, "Dashboard Module/services/summaryApi.js"), "utf8");
  assert.doesNotMatch(src, /\.limit\(5000\)/);
  assert.match(src, /allRows\(\(\) => supabase\.from\("accounting_job_list"\)[^\n]*\.order\("id"\)/);
  assert.match(src, /allRows\(\(\) => supabase\.from\("client_master"\)[^\n]*\.order\("client_id"\)/);
});

test("the Business Development screen uses the shared open lead rule, with no copy of its own", () => {
  const src = readFileSync(join(repo, "Business Development Module/components/BusinessDevelopment.jsx"), "utf8");
  assert.match(src, /import \{ isOpen \} from "\.\.\/logic\/leadRules\.js"/);
  assert.doesNotMatch(src, /const isOpen =/);
});

test("the Zoho hook reads the row again once after a busy result, and the row's error is not treated as a login state", () => {
  const src = read("ZohoSection.jsx");
  assert.equal((src.match(/setTimeout\(/g) || []).length, 1);
  assert.match(src, /clearTimeout\(reread\.current\);\s*reread\.current = setTimeout/);
  assert.doesNotMatch(src, /(r|next)\.error === "not_connected"/);
  // The delayed read only reads: it must not start another refresh.
  const timer = src.slice(src.indexOf("reread.current = setTimeout"), src.indexOf("BUSY_REREAD_MS);"));
  assert.doesNotMatch(timer, /run\(|refreshSnapshot/);
});
