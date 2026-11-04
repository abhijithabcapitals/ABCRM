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
