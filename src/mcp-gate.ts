/**
 * MCP pre-checks and the MCP judge. Pure over the injected `ask`: a call with
 * no input preview or a write-verb name defers without a model call; anything
 * else goes through the shared core in gate.ts.
 */

import { type GateOutcome, judgeState, type McpAskFn } from "./gate.ts";
import { redactForReview } from "./redact.ts";

export const WRITE_VERBS: readonly string[] = [
  "delete",
  "remove",
  "destroy",
  "drop",
  "send",
  "post",
  "create",
  "update",
  "write",
  "set",
  "put",
  "patch",
  "exec",
  "run",
];

/** The first write verb that is a whole token of the name, lowercased. */
export function writeVerbOf(name: string): string | undefined {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return tokens.find((token) => WRITE_VERBS.includes(token));
}

/** The text of the `input` evidence entry, or undefined when the formatter gave none. */
export function mcpInputOf(
  evidence: ReadonlyArray<{ label: string; text: string }>,
): string | undefined {
  return evidence.find((entry) => entry.label === "input")?.text;
}

export async function judgeMcpCall(
  input: {
    target: string;
    toolName: string;
    evidence: ReadonlyArray<{ label: string; text: string }>;
    cwd: string;
  },
  deps: { ask: McpAskFn },
): Promise<GateOutcome> {
  const startedAt = Date.now();
  const preCheckDefer = (deferReason: GateOutcome["deferReason"]): GateOutcome => ({
    verdict: "defer",
    deferReason,
    latencyMs: Date.now() - startedAt,
    contextBytes: 0,
    contextHash: "",
  });

  const rawInput = mcpInputOf(input.evidence);
  if (rawInput === undefined) return preCheckDefer("no-input-preview");
  // A proxied call gates under the proxy's name, so the real tool name is in the target.
  if (writeVerbOf(input.toolName) !== undefined || writeVerbOf(input.target) !== undefined) {
    return preCheckDefer("write-verb");
  }

  return judgeState(
    {
      target: redactForReview(input.target),
      input: redactForReview(rawInput),
      cwd: redactForReview(input.cwd),
    },
    deps,
  );
}
