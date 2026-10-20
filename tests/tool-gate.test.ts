import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChoiceAnswer } from "system-one-core";

import type { GateChoice, McpAskFn, McpState } from "../src/gate.ts";
import { judgeToolCall } from "../src/tool-gate.ts";

function answer(choice: GateChoice, pSafe: number): ChoiceAnswer<GateChoice> {
  const rest = (1 - pSafe) / 2;
  return {
    type: "choice",
    choice,
    probabilities: { safe: pSafe, dangerous: rest, unsure: rest },
    confidence: 0.9,
  };
}

function fakeAsk(result: ChoiceAnswer<GateChoice>) {
  const calls: McpState[] = [];
  const ask: McpAskFn = async (state) => {
    calls.push(state);
    return result;
  };
  return { ask, calls };
}

test("judgeToolCall defers no-evidence asks without calling ask", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeToolCall({ target: "/w/a.ts", toolName: "/w/a.ts", evidence: [], cwd: "/w" }, { ask });
  assert.equal(out.deferReason, "no-input-preview");
  assert.equal(calls.length, 0);
});

test("judgeToolCall defers a write-verb tool name without calling ask", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeToolCall(
    { target: "write", toolName: "write", evidence: [{ label: "input", text: "{}" }], cwd: "/w" },
    { ask },
  );
  assert.equal(out.deferReason, "write-verb");
  assert.equal(calls.length, 0);
});

test("judgeToolCall joins every evidence entry and redacts the state", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeToolCall(
    {
      target: "read",
      toolName: "read",
      evidence: [
        { label: "input", text: '{"path":"a.ts"}' },
        { label: "resolves to", text: "--token abc123secret" },
      ],
      cwd: "/w",
    },
    { ask },
  );
  assert.equal(out.verdict, "allow");
  assert.ok(calls[0].input.includes('input: {"path":"a.ts"}'));
  assert.ok(calls[0].input.includes("resolves to: "));
  assert.ok(!calls[0].input.includes("abc123secret"));
});
