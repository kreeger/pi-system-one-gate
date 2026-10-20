import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ChoiceAnswer,
  SystemOneConfigurationError,
  SystemOneHttpError,
  SystemOneProtocolError,
  SystemOneTimeoutError,
  SystemOneTransportError,
} from "system-one-core";

import {
  type AskFn,
  type GateChoice,
  type GateState,
  judgeCommand,
  reasonForError,
  reviewFields,
  THRESHOLD,
} from "../src/gate.ts";

function answer(choice: GateChoice, pSafe: number): ChoiceAnswer<GateChoice> {
  const rest = (1 - pSafe) / 2;
  return {
    type: "choice",
    choice,
    probabilities: { safe: pSafe, dangerous: rest, unsure: rest },
    confidence: 0.9,
  };
}

function fakeAsk(result: ChoiceAnswer<GateChoice> | Error) {
  const calls: GateState[] = [];
  const ask: AskFn = async (state) => {
    calls.push(state);
    if (result instanceof Error) throw result;
    return result;
  };
  return { ask, calls };
}

/** A command whose serialized state is exactly `bytes` long (ASCII, cwd "/w"). */
function commandOfStateBytes(bytes: number): string {
  const base = JSON.stringify({ command: "", cwd: "/w" }).length;
  return "a".repeat(bytes - base);
}

test("allows a safe answer at exactly the threshold", async () => {
  assert.equal(THRESHOLD, 0.9);
  const { ask } = fakeAsk(answer("safe", 0.9));
  const out = await judgeCommand({ command: "ls", cwd: "/w" }, { ask });
  assert.equal(out.verdict, "allow");
  assert.equal(out.deferReason, undefined);
});

test("defers a safe answer just below the threshold", async () => {
  const { ask } = fakeAsk(answer("safe", 0.8999));
  const out = await judgeCommand({ command: "ls", cwd: "/w" }, { ask });
  assert.equal(out.verdict, "defer");
  assert.equal(out.deferReason, "below-threshold");
});

test("defers a dangerous answer even when its pSafe is high", async () => {
  const { ask } = fakeAsk({
    type: "choice",
    choice: "dangerous",
    probabilities: { safe: 0.95, dangerous: 0.03, unsure: 0.02 },
    confidence: 0.9,
  });
  const out = await judgeCommand({ command: "rm -rf x", cwd: "/w" }, { ask });
  assert.equal(out.verdict, "defer");
  assert.equal(out.deferReason, "dangerous");
});

test("defers an unsure answer", async () => {
  const { ask } = fakeAsk(answer("unsure", 0.5));
  const out = await judgeCommand({ command: "x", cwd: "/w" }, { ask });
  assert.equal(out.verdict, "defer");
  assert.equal(out.deferReason, "unsure");
});

test("judges a state of exactly 8192 bytes", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeCommand(
    { command: commandOfStateBytes(8192), cwd: "/w" },
    { ask },
  );
  assert.equal(calls.length, 1);
  assert.equal(out.verdict, "allow");
  assert.equal(out.contextBytes, 8192);
});

test("defers a state of 8193 bytes over-cap without calling ask", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  const out = await judgeCommand(
    { command: commandOfStateBytes(8193), cwd: "/w" },
    { ask },
  );
  assert.equal(calls.length, 0);
  assert.equal(out.verdict, "defer");
  assert.equal(out.deferReason, "over-cap");
});

test("counts UTF-8 bytes, not characters, against the cap", async () => {
  const under = fakeAsk(answer("safe", 0.99));
  const ok = await judgeCommand({ command: "é".repeat(4000), cwd: "/w" }, { ask: under.ask });
  assert.equal(ok.verdict, "allow");

  const over = fakeAsk(answer("safe", 0.99));
  const out = await judgeCommand({ command: "é".repeat(4097), cwd: "/w" }, { ask: over.ask });
  assert.equal(over.calls.length, 0);
  assert.equal(out.deferReason, "over-cap");
});

test("sends the redacted command to ask", async () => {
  const { ask, calls } = fakeAsk(answer("safe", 0.99));
  await judgeCommand({ command: "API_TOKEN=abc123 npm test", cwd: "/w" }, { ask });
  assert.equal(calls[0].command, "API_TOKEN=<redacted> npm test");
});

test("maps each error class to its defer reason", async () => {
  const cases: Array<[Error, string]> = [
    [new SystemOneTimeoutError("slow"), "timeout"],
    [new SystemOneHttpError("bad", { status: 500, provider: "x" }), "http-error"],
    [new SystemOneTransportError("down"), "http-error"],
    [new SystemOneProtocolError("garbled"), "unparseable"],
    [new SystemOneConfigurationError("no key"), "misconfigured"],
    [new Error("boom"), "internal-error"],
  ];
  for (const [error, reason] of cases) {
    assert.equal(reasonForError(error), reason, error.message);
    const { ask } = fakeAsk(error);
    const out = await judgeCommand({ command: "ls", cwd: "/w" }, { ask });
    assert.equal(out.verdict, "defer");
    assert.equal(out.deferReason, reason);
  }
});

test("reviewFields carries no command, cwd, or state text", async () => {
  const { ask } = fakeAsk(answer("dangerous", 0.1));
  const out = await judgeCommand(
    { command: "echo sekrit_value_42", cwd: "/secret/dir" },
    { ask },
  );
  const json = JSON.stringify(reviewFields(out, { requestId: "r1", backend: "reflex" }));
  assert.ok(!json.includes("sekrit"));
  assert.ok(!json.includes("echo"));
  assert.ok(!json.includes("/secret/dir"));
});

test("reviewFields reports the decision facts", async () => {
  const { ask } = fakeAsk(answer("safe", 0.93));
  const out = await judgeCommand({ command: "ls", cwd: "/w" }, { ask });
  const fields = reviewFields(out, { requestId: "r1", backend: "reflex" });
  assert.equal(fields.requestId, "r1");
  assert.equal(fields.backend, "reflex");
  assert.equal(fields.verdict, "allow");
  assert.equal(fields.deferReason, null);
  assert.equal(fields.choice, "safe");
  assert.equal(fields.pSafe, 0.93);
  assert.equal(fields.threshold, 0.9);
  assert.equal(typeof fields.latencyMs, "number");
});

test("contextHash is 12 lowercase hex and stable for the same state", async () => {
  const a = fakeAsk(answer("safe", 0.99));
  const b = fakeAsk(answer("safe", 0.99));
  const first = await judgeCommand({ command: "ls", cwd: "/w" }, { ask: a.ask });
  const second = await judgeCommand({ command: "ls", cwd: "/w" }, { ask: b.ask });
  assert.match(first.contextHash ?? "", /^[0-9a-f]{12}$/);
  assert.equal(first.contextHash, second.contextHash);
});
