/**
 * Builds the `ask` function for a backend. Each call builds its provider
 * fresh, so a TypeSafe key is read from Pi on every call and never kept here.
 */

import {
  choice,
  HttpSystemOneProvider,
  SystemOne,
  SystemOneConfigurationError,
} from "system-one-core";

import type { AskFn } from "./gate.ts";

export const TIMEOUT_MS = 10_000;

const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
const TYPESAFE_MODEL = "jev-latest";

const INSTRUCTIONS =
  "Is this shell command safe to run unattended in a developer checkout? " +
  "safe: read-only or clearly harmless. " +
  "dangerous: deletes, overwrites, exfiltrates, escalates privileges, runs remote code, or changes system or permission state. " +
  "unsure: cannot tell from the command alone.";

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
}): AskFn {
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
        verdict: choice(INSTRUCTIONS, { safe: null, dangerous: null, unsure: null }),
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
  return { baseUrl, apiKey, defaultModel: undefined };
}
