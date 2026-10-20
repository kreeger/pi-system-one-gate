/**
 * The decision core: redact, size-check, ask System One, and map the answer to
 * `allow` or `defer`. Never `deny`. Pure over the injected `ask`, so the tests
 * run without a network.
 */

import { createHash } from "node:crypto";

import {
  type ChoiceAnswer,
  SystemOneConfigurationError,
  SystemOneHttpError,
  SystemOneProtocolError,
  SystemOneTimeoutError,
  SystemOneTransportError,
} from "system-one-core";

import { redactForReview } from "./redact.ts";

/** Auto-approve only at or above this P(safe). Inclusive. */
export const THRESHOLD = 0.9;

/** Serialized state cap, in UTF-8 bytes. Over the cap defers; never truncates. */
export const MAX_CONTEXT_BYTES = 8192;

export type GateChoice = "safe" | "dangerous" | "unsure";

/** A type alias, not an interface: System One's JsonValue needs an implicit index signature. */
export type GateState = { command: string; cwd: string };

/** An MCP ask's state: the qualified target, the formatted input, and the cwd. */
export type McpState = { target: string; input: string; cwd: string };

export type AnyState = GateState | McpState;

export type AskFn = (state: GateState) => Promise<ChoiceAnswer<GateChoice>>;

export type McpAskFn = (state: McpState) => Promise<ChoiceAnswer<GateChoice>>;

export type DeferReason =
  | "over-cap"
  | "dangerous"
  | "unsure"
  | "below-threshold"
  | "timeout"
  | "http-error"
  | "unparseable"
  | "misconfigured"
  | "internal-error"
  | "not-bash"
  | "no-input-preview"
  | "write-verb";

export interface GateOutcome {
  verdict: "allow" | "defer";
  deferReason?: DeferReason;
  choice?: GateChoice;
  probabilities?: Record<GateChoice, number>;
  confidence?: number;
  latencyMs: number;
  contextBytes: number;
  contextHash: string;
}

export function reasonForError(error: unknown): DeferReason {
  if (error instanceof SystemOneTimeoutError) return "timeout";
  if (error instanceof SystemOneHttpError || error instanceof SystemOneTransportError) {
    return "http-error";
  }
  if (error instanceof SystemOneProtocolError) return "unparseable";
  if (error instanceof SystemOneConfigurationError) return "misconfigured";
  return "internal-error";
}

export async function judgeCommand(
  input: { command: string; cwd: string },
  deps: { ask: AskFn },
): Promise<GateOutcome> {
  return judgeState(
    { command: redactForReview(input.command), cwd: redactForReview(input.cwd) },
    deps,
  );
}

/** Cap, ask, and map to a verdict. The caller redacts the state it passes in. */
export async function judgeState<S extends AnyState>(
  state: S,
  deps: { ask: (state: S) => Promise<ChoiceAnswer<GateChoice>> },
): Promise<GateOutcome> {
  const startedAt = Date.now();
  const serialized = JSON.stringify(state);
  const contextBytes = Buffer.byteLength(serialized, "utf8");
  const contextHash = createHash("sha256").update(serialized, "utf8").digest("hex").slice(0, 12);
  const elapsed = () => Date.now() - startedAt;

  if (contextBytes > MAX_CONTEXT_BYTES) {
    return { verdict: "defer", deferReason: "over-cap", latencyMs: elapsed(), contextBytes, contextHash };
  }

  let answer: ChoiceAnswer<GateChoice>;
  try {
    answer = await deps.ask(state);
  } catch (error) {
    return {
      verdict: "defer",
      deferReason: reasonForError(error),
      latencyMs: elapsed(),
      contextBytes,
      contextHash,
    };
  }

  const decided = {
    choice: answer.choice,
    probabilities: answer.probabilities,
    confidence: answer.confidence,
    latencyMs: elapsed(),
    contextBytes,
    contextHash,
  };
  if (answer.choice === "safe" && answer.probabilities.safe >= THRESHOLD) {
    return { verdict: "allow", ...decided };
  }
  const deferReason: DeferReason =
    answer.choice === "dangerous" ? "dangerous" : answer.choice === "unsure" ? "unsure" : "below-threshold";
  return { verdict: "defer", deferReason, ...decided };
}

export function reviewFields(
  outcome: GateOutcome,
  meta: { requestId: string; backend: string },
): Record<string, unknown> {
  return {
    requestId: meta.requestId,
    backend: meta.backend,
    verdict: outcome.verdict,
    deferReason: outcome.deferReason ?? null,
    choice: outcome.choice ?? null,
    pSafe: outcome.probabilities?.safe ?? null,
    probabilities: outcome.probabilities ?? null,
    confidence: outcome.confidence ?? null,
    latencyMs: outcome.latencyMs,
    contextBytes: outcome.contextBytes,
    contextHash: outcome.contextHash,
    threshold: THRESHOLD,
  };
}
