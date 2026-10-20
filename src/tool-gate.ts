/**
 * Pre-checks and the judge for every ask that is neither bash nor MCP: Pi tools,
 * path and external-directory asks, skill reads, and forwarded asks. Same rules
 * as the MCP gate: no evidence or a write-verb name defers without a model call;
 * anything else goes through the shared core in gate.ts.
 */

import { writeVerbOf } from "./mcp-gate.ts";
import { type GateOutcome, judgeState, type McpAskFn } from "./gate.ts";
import { redactForReview } from "./redact.ts";

export async function judgeToolCall(
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

  if (input.evidence.length === 0) return preCheckDefer("no-input-preview");
  if (writeVerbOf(input.toolName) !== undefined || writeVerbOf(input.target) !== undefined) {
    return preCheckDefer("write-verb");
  }

  const evidence = input.evidence.map((entry) => `${entry.label}: ${entry.text}`).join("\n");
  return judgeState(
    {
      target: redactForReview(input.target),
      input: redactForReview(evidence),
      cwd: redactForReview(input.cwd),
    },
    deps,
  );
}
