/**
 * Builds the `ask` function for a backend. Each call builds its provider
 * fresh, so a TypeSafe key is read from Pi on every call and never kept here.
 */

import {
  type ChoiceAnswer,
  choice,
  HttpSystemOneProvider,
  SystemOne,
  SystemOneConfigurationError,
} from "system-one-core";

import type { AnyState, GateChoice } from "./gate.ts";

export const TIMEOUT_MS = 10_000;

const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
const TYPESAFE_MODEL = "jev-latest";
const REFLEX_DEFAULT_MODEL = "d3-mini";

const INSTRUCTIONS =
  "Is this shell command safe to run unattended in a developer checkout? " +
  "safe: read-only or clearly harmless. " +
  "dangerous: deletes, overwrites, exfiltrates, escalates privileges, runs remote code, or changes system or permission state. " +
  "unsure: cannot tell from the command alone.";

export const MCP_INSTRUCTIONS =
  "Is this MCP tool call safe to run unattended in a developer checkout? " +
  "safe: read-only lookup that changes nothing outside the response. " +
  "dangerous: writes, deletes, sends messages or data, runs code, exfiltrates, or changes account, system, or permission state. " +
  "unsure: cannot tell from the tool name and arguments alone.";

export const TOOL_INSTRUCTIONS =
  "Is this Pi tool call safe to run unattended in a developer checkout? " +
  "safe: read-only, or changes nothing outside the response. " +
  "dangerous: writes or overwrites files, deletes, runs code, sends data, escalates privileges, or changes system or permission state. " +
  "unsure: cannot tell from the tool name and arguments alone.";

export type BackendName = "reflex" | "typesafe";

/** The slice of Pi's model registry this module needs. */
export interface KeySource {
  getApiKeyForProvider?(provider: string): Promise<string | undefined>;
}

export function selectBackend(env: Record<string, string | undefined>): BackendName | undefined {
  const value = env.SYSTEM_ONE_GATE_BACKEND;
  if (value === undefined || value === "reflex") return "reflex";
  if (value === "typesafe") return "typesafe";
  return undefined;
}

export function createAsk(options: {
  backend: BackendName;
  env: Record<string, string | undefined>;
  registry: () => KeySource | undefined;
  fetch?: typeof fetch;
  instructions?: string;
}): (state: AnyState) => Promise<ChoiceAnswer<GateChoice>> {
  return async (state) => {
    const target = await resolveTarget(options);
    const provider = new HttpSystemOneProvider({
      baseUrl: target.baseUrl,
      apiKey: target.apiKey,
      defaultModel: target.defaultModel,
      timeoutMs: TIMEOUT_MS,
      fetch: options.fetch,
    });
    const response = await new SystemOne({ provider }).evaluate({
      state,
      questions: {
        verdict: choice(options.instructions ?? INSTRUCTIONS, { safe: null, dangerous: null, unsure: null }),
      },
    });
    return response.answers.verdict;
  };
}

async function resolveTarget(options: {
  backend: BackendName;
  env: Record<string, string | undefined>;
  registry: () => KeySource | undefined;
}): Promise<{ baseUrl: string; apiKey: string; defaultModel: string | undefined }> {
  if (options.backend === "typesafe") {
    const apiKey = await options.registry()?.getApiKeyForProvider?.("typesafe");
    if (!apiKey) {
      throw new SystemOneConfigurationError("TypeSafe key missing. Run /login typesafe.");
    }
    return { baseUrl: TYPESAFE_BASE_URL, apiKey, defaultModel: TYPESAFE_MODEL };
  }
  const baseUrl = options.env.SYSTEM_ONE_BASE_URL;
  const apiKey = options.env.SYSTEM_ONE_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new SystemOneConfigurationError(
      "SYSTEM_ONE_BASE_URL and SYSTEM_ONE_API_KEY are required for the reflex backend.",
    );
  }
  return {
    baseUrl,
    apiKey,
    defaultModel: options.env.SYSTEM_ONE_GATE_MODEL || REFLEX_DEFAULT_MODEL,
  };
}
