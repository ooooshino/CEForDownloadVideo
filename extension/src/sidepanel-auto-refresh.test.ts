import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/sidepanel.ts", "utf8");

test("side panel does not start a timer-based auto refresh loop", () => {
  assert.equal(source.includes("setInterval"), false);
  assert.equal(source.includes("startAutoRefresh"), false);
  assert.equal(source.includes("clearInterval"), false);
});
