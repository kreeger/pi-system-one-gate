import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChoiceAnswer } from "system-one-core";

import type { GateChoice, McpAskFn, McpState } from "../src/gate.ts";
import { judgeMcpCall, mcpInputOf, writeVerbOf } from "../src/mcp-gate.ts";

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

test("writeVerbOf matches a write verb as a whole token", () => {
  assert.equal(writeVerbOf("github_delete_issue"), "delete");
  assert.equal(writeVerbOf("mcp__srv__deleteIssue"), "delete");
  assert.equal(writeVerbOf("Create_Item"), "create");
  assert.equal(writeVerbOf("get_settings"), undefined); // "set" is not a token of "settings"
  assert.equal(writeVerbOf("sender_list"), undefined); // "send" is not a token of "sender"
  assert.equal(writeVerbOf("search_code"), undefined);
});

test("mcpInputOf returns the input evidence text, or undefined when absent", () => {
  assert.equal(mcpInputOf([{ label: "input", text: '{"q":1}' }]), '{"q":1}');
  assert.equal(mcpInputOf([]), undefined);
  assert.equal(mcpInputOf([{ label: "full command", text: "x" }]), undefined);
});

test("judgeMcpCall defers no-input-preview without calling ask", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeMcpCall(
    { target: "srv_list", toolName: "srv_list", evidence: [], cwd: "/w" },
    { ask },
  );
  assert.equal(out.deferReason, "no-input-preview");
  assert.equal(calls.length, 0);
});

test("judgeMcpCall defers write-verb without calling ask", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeMcpCall(
    {
      target: "srv_delete_issue",
      toolName: "srv_delete_issue",
      evidence: [{ label: "input", text: "{}" }],
      cwd: "/w",
    },
    { ask },
  );
  assert.equal(out.deferReason, "write-verb");
  assert.equal(calls.length, 0);
});

test("judgeMcpCall allows a safe answer at the threshold", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.9));
  const out = await judgeMcpCall(
    {
      target: "srv_search",
      toolName: "srv_search",
      evidence: [{ label: "input", text: '{"q":"x"}' }],
      cwd: "/w",
    },
    { ask },
  );
  assert.equal(out.verdict, "allow");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { target: "srv_search", input: '{"q":"x"}', cwd: "/w" });
});

test("judgeMcpCall redacts a secret in the input before the state is built", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  await judgeMcpCall(
    {
      target: "srv_search",
      toolName: "srv_search",
      evidence: [{ label: "input", text: "--token abc123secret" }],
      cwd: "/w",
    },
    { ask },
  );
  assert.ok(!calls[0].input.includes("abc123secret"));
});

test("judgeMcpCall maps a dangerous answer to defer dangerous", async () => {
  const { ask } = fakeAsk(answer("dangerous", 0.05));
  const out = await judgeMcpCall(
    {
      target: "srv_search",
      toolName: "srv_search",
      evidence: [{ label: "input", text: "{}" }],
      cwd: "/w",
    },
    { ask },
  );
  assert.equal(out.deferReason, "dangerous");
});

test("judgeMcpCall judges a state of exactly 8192 bytes and defers 8193 over-cap", async () => {
  const stateBytes = (input: string) =>
    Buffer.byteLength(JSON.stringify({ target: "srv_search", input, cwd: "/w" }), "utf8");
  const base = stateBytes("");
  const exact = "a".repeat(8192 - base);
  assert.equal(stateBytes(exact), 8192);

  const under = fakeAsk(answer("safe", 0.99));
  const ok = await judgeMcpCall(
    { target: "srv_search", toolName: "srv_search", evidence: [{ label: "input", text: exact }], cwd: "/w" },
    { ask: under.ask },
  );
  assert.equal(under.calls.length, 1);
  assert.equal(ok.verdict, "allow");
  assert.equal(ok.contextBytes, 8192);

  const over = fakeAsk(answer("safe", 0.99));
  const out = await judgeMcpCall(
    {
      target: "srv_search",
      toolName: "srv_search",
      evidence: [{ label: "input", text: exact + "a" }],
      cwd: "/w",
    },
    { ask: over.ask },
  );
  assert.equal(over.calls.length, 0);
  assert.equal(out.deferReason, "over-cap");
});

test("judgeMcpCall checks the target too, so a proxied write verb defers", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeMcpCall(
    { target: "srv_delete_issue", toolName: "mcp", evidence: [{ label: "input", text: "{}" }], cwd: "/w" },
    { ask },
  );
  assert.equal(out.deferReason, "write-verb");
  assert.equal(calls.length, 0);
});
