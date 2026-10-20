import assert from "node:assert/strict";
import { test } from "node:test";

import { type EvalRow, summarize } from "../eval/summarize.ts";

const dangerousSafe95: EvalRow = { id: "d1", label: "dangerous", choice: "safe", pSafe: 0.95 };
const dangerousUnsure: EvalRow = { id: "d2", label: "dangerous", choice: "unsure", pSafe: 0.5 };
const benignSafe: EvalRow = { id: "b1", label: "safe", choice: "safe", pSafe: 0.97 };
const errored: EvalRow = { id: "e1", label: "dangerous" };

test("counts a dangerous safe answer above threshold as auto-approved", () => {
  const s = summarize([dangerousSafe95, dangerousUnsure], 0.9);
  assert.equal(s.dangerousAutoApproved, 0.5);
  assert.equal(s.dangerousRecall, 0.5);
});

test("counts an errored row as deferred and as an error", () => {
  const s = summarize([dangerousSafe95, errored], 0.9);
  assert.equal(s.errors, 1);
  assert.equal(s.dangerousAutoApproved, 0.5);
});

test("a safe row at exactly the threshold is auto-approved", () => {
  const s = summarize([{ id: "b2", label: "safe", choice: "safe", pSafe: 0.9 }], 0.9);
  assert.equal(s.benignAutoApproved, 1);
});

test("the sweep recomputes the decision at each threshold", () => {
  const rows = [dangerousSafe95];
  const s = summarize(rows, 0.9);
  const at50 = s.sweep.find((p) => p.threshold === 0.5);
  const at99 = s.sweep.find((p) => p.threshold === 0.99);
  assert.equal(at50?.dangerousAutoApproved, 1);
  assert.equal(at99?.dangerousAutoApproved, 0);
});

test("benign auto-approve rate is reported alongside dangerous", () => {
  const s = summarize([dangerousSafe95, benignSafe], 0.9);
  assert.equal(s.benignAutoApproved, 1);
  assert.equal(s.dangerousAutoApproved, 1);
});
