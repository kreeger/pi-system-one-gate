import assert from "node:assert/strict";
import { test } from "node:test";

import { SystemOneConfigurationError } from "system-one-core";

import { createAsk, type KeySource, selectBackend } from "../src/backend.ts";

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(choice = "safe", pSafe = 0.95) {
  const calls: Recorded[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    const rest = (1 - pSafe) / 2;
    const body = {
      answers: {
        verdict: {
          type: "choice",
          choice,
          probabilities: { safe: pSafe, dangerous: rest, unsure: rest },
          confidence: 0.9,
        },
      },
      metadata: { provider: "test" },
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { fn, calls };
}

function registryWithKey(key: string | undefined): () => KeySource {
  return () => ({ getApiKeyForProvider: async () => key });
}

const STATE = { command: "ls", cwd: "/w" };

test("selectBackend defaults to reflex and accepts only the two names", () => {
  assert.equal(selectBackend({}), "reflex");
  assert.equal(selectBackend({ SYSTEM_ONE_GATE_BACKEND: "reflex" }), "reflex");
  assert.equal(selectBackend({ SYSTEM_ONE_GATE_BACKEND: "typesafe" }), "typesafe");
  assert.equal(selectBackend({ SYSTEM_ONE_GATE_BACKEND: "TypeSafe" }), undefined);
  assert.equal(selectBackend({ SYSTEM_ONE_GATE_BACKEND: "bogus" }), undefined);
});

test("reflex without SYSTEM_ONE_BASE_URL is a configuration error and makes no call", async () => {
  const { fn, calls } = fakeFetch();
  const ask = createAsk({
    backend: "reflex",
    env: { SYSTEM_ONE_API_KEY: "k" },
    registry: () => undefined,
    fetch: fn,
  });
  await assert.rejects(ask(STATE), SystemOneConfigurationError);
  assert.equal(calls.length, 0);
});

test("reflex without SYSTEM_ONE_API_KEY is a configuration error and makes no call", async () => {
  const { fn, calls } = fakeFetch();
  const ask = createAsk({
    backend: "reflex",
    env: { SYSTEM_ONE_BASE_URL: "https://reflex.example.com" },
    registry: () => undefined,
    fetch: fn,
  });
  await assert.rejects(ask(STATE), SystemOneConfigurationError);
  assert.equal(calls.length, 0);
});

test("reflex posts with the default model d3-mini when SYSTEM_ONE_GATE_MODEL is unset", async () => {
  const { fn, calls } = fakeFetch("safe", 0.95);
  const ask = createAsk({
    backend: "reflex",
    env: { SYSTEM_ONE_BASE_URL: "https://reflex.example.com", SYSTEM_ONE_API_KEY: "k-123" },
    registry: () => undefined,
    fetch: fn,
  });
  const answer = await ask(STATE);
  assert.equal(calls[0].url, "https://reflex.example.com/v1/systemone");
  assert.equal(calls[0].headers.Authorization, "Bearer k-123");
  assert.equal((calls[0].body.questions as Record<string, { type: string }>).verdict.type, "choice");
  assert.equal(calls[0].body.model, "d3-mini");
  assert.equal(answer.choice, "safe");
  assert.equal(answer.probabilities.safe, 0.95);
});

test("reflex uses SYSTEM_ONE_GATE_MODEL when set", async () => {
  const { fn, calls } = fakeFetch();
  const ask = createAsk({
    backend: "reflex",
    env: {
      SYSTEM_ONE_BASE_URL: "https://reflex.example.com",
      SYSTEM_ONE_API_KEY: "k-123",
      SYSTEM_ONE_GATE_MODEL: "qwen/small",
    },
    registry: () => undefined,
    fetch: fn,
  });
  await ask(STATE);
  assert.equal(calls[0].body.model, "qwen/small");
});

test("typesafe without a stored key is a configuration error and makes no call", async () => {
  const { fn, calls } = fakeFetch();
  const ask = createAsk({
    backend: "typesafe",
    env: {},
    registry: registryWithKey(undefined),
    fetch: fn,
  });
  await assert.rejects(ask(STATE), SystemOneConfigurationError);
  assert.equal(calls.length, 0);
});

test("typesafe posts to api.typesafe.ai with jev-latest and the stored key", async () => {
  const { fn, calls } = fakeFetch();
  const ask = createAsk({
    backend: "typesafe",
    env: {},
    registry: registryWithKey("ts-key"),
    fetch: fn,
  });
  await ask(STATE);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].headers.Authorization, "Bearer ts-key");
  assert.equal(calls[0].body.model, "jev-latest");
});

test("typesafe ignores SYSTEM_ONE_BASE_URL so its key never goes to a custom endpoint", async () => {
  const { fn, calls } = fakeFetch();
  const ask = createAsk({
    backend: "typesafe",
    env: { SYSTEM_ONE_BASE_URL: "https://attacker.example" },
    registry: registryWithKey("ts-key"),
    fetch: fn,
  });
  await ask(STATE);
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
});

test("typesafe reads the key on every call", async () => {
  let reads = 0;
  const { fn } = fakeFetch();
  const ask = createAsk({
    backend: "typesafe",
    env: {},
    registry: () => ({
      getApiKeyForProvider: async () => {
        reads += 1;
        return "ts-key";
      },
    }),
    fetch: fn,
  });
  await ask(STATE);
  await ask(STATE);
  assert.equal(reads, 2);
});
