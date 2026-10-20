import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type Authorizer,
  type AuthorizerLog,
  PERMISSIONS_READY_CHANNEL,
  type PermissionsService,
  publishPermissionsService,
  unpublishPermissionsService,
} from "@gotgenes/pi-permission-system";

import systemOneGate from "../src/index.ts";

const SESSION = "session-1";
const ENV_KEYS = [
  "SYSTEM_ONE_GATE_BACKEND",
  "SYSTEM_ONE_BASE_URL",
  "SYSTEM_ONE_API_KEY",
] as const;

type Handler = (event: unknown, ctx?: unknown) => unknown;

function fakePi() {
  const channels = new Map<string, Handler[]>();
  const events = new Map<string, Handler[]>();
  const add = (map: Map<string, Handler[]>, name: string, fn: Handler) => {
    map.set(name, [...(map.get(name) ?? []), fn]);
  };
  const pi = {
    events: { on: (name: string, fn: Handler) => add(channels, name, fn) },
    on: (name: string, fn: Handler) => add(events, name, fn),
  };
  return {
    api: pi as unknown as ExtensionAPI,
    emitChannel: (name: string, payload: unknown) => {
      for (const fn of channels.get(name) ?? []) fn(payload);
    },
    emit: (name: string, payload: unknown, ctx?: unknown) => {
      for (const fn of events.get(name) ?? []) fn(payload, ctx);
    },
  };
}

function fakeService() {
  const registrations: string[] = [];
  const links = new Map<string, Authorizer["authorize"]>();
  let disposed = 0;
  const service = {
    registerAuthorizer(name: string, authorize: Authorizer["authorize"]) {
      registrations.push(name);
      links.set(name, authorize);
      return () => {
        disposed += 1;
        links.delete(name);
      };
    },
  };
  return {
    service: service as unknown as PermissionsService,
    registrations,
    link: (name: string) => links.get(name),
    disposedCount: () => disposed,
  };
}

function fakeLog() {
  const records: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const log: AuthorizerLog = {
    review: (event, fields) => records.push({ event, fields: fields ?? {} }),
    debug: () => {},
  };
  return { log, records };
}

function bashDetails(command: string) {
  return {
    requestId: "req-1",
    command,
    payload: { kind: "bash", request: { value: command }, evidence: [] },
  } as never;
}

function fakeFetch(choice: string, pSafe: number) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const rest = (1 - pSafe) / 2;
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: init?.headers as Record<string, string> });
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

let savedEnv: Record<string, string | undefined>;
let savedFetch: typeof fetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  savedFetch = globalThis.fetch;
  process.env.SYSTEM_ONE_BASE_URL = "https://reflex.example.com";
  process.env.SYSTEM_ONE_API_KEY = "k-123";
  delete process.env.SYSTEM_ONE_GATE_BACKEND;
});

afterEach(() => {
  if (published) unpublishPermissionsService(SESSION, published);
  published = undefined;
  globalThis.fetch = savedFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

let published: PermissionsService | undefined;

function startWith(service: ReturnType<typeof fakeService>) {
  const pi = fakePi();
  systemOneGate(pi.api);
  publishPermissionsService(SESSION, service.service);
  published = service.service;
  return pi;
}

test("registers the system-one link once when permissions:ready fires twice", () => {
  const svc = fakeService();
  const pi = startWith(svc);
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  assert.deepEqual(svc.registrations, ["system-one"]);
});

test("registers nothing when SYSTEM_ONE_GATE_BACKEND is unrecognized", () => {
  process.env.SYSTEM_ONE_GATE_BACKEND = "bogus";
  const svc = fakeService();
  const pi = startWith(svc);
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  assert.deepEqual(svc.registrations, []);
});

test("a non-bash ask defers as not-bash and never calls the backend", async () => {
  const svc = fakeService();
  const pi = startWith(svc);
  const { fn, calls } = fakeFetch("safe", 0.99);
  globalThis.fetch = fn;
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  const authorize = svc.link("system-one");
  assert.ok(authorize);
  const { log, records } = fakeLog();

  const verdict = await authorize(
    { requestId: "req-2", payload: { kind: "tool", request: { value: "read" } } } as never,
    {} as never,
    log,
  );

  assert.deepEqual(verdict, { kind: "defer" });
  assert.equal(calls.length, 0);
  assert.equal(records[0].fields.deferReason, "not-bash");
});

test("a safe bash ask returns allow and logs one entry", async () => {
  const svc = fakeService();
  const pi = startWith(svc);
  const { fn } = fakeFetch("safe", 0.95);
  globalThis.fetch = fn;
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  const { log, records } = fakeLog();

  const verdict = await svc.link("system-one")!(bashDetails("ls -la"), {} as never, log);

  assert.deepEqual(verdict, { kind: "allow" });
  assert.equal(records.length, 1);
  assert.equal(records[0].event, "system-one.decision");
  assert.equal(records[0].fields.verdict, "allow");
});

test("a dangerous bash ask returns defer", async () => {
  const svc = fakeService();
  const pi = startWith(svc);
  const { fn } = fakeFetch("dangerous", 0.05);
  globalThis.fetch = fn;
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  const { log } = fakeLog();

  const verdict = await svc.link("system-one")!(bashDetails("rm -rf ."), {} as never, log);

  assert.deepEqual(verdict, { kind: "defer" });
});

test("the review log entry never contains the command", async () => {
  const svc = fakeService();
  const pi = startWith(svc);
  const { fn } = fakeFetch("safe", 0.95);
  globalThis.fetch = fn;
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  const { log, records } = fakeLog();

  await svc.link("system-one")!(bashDetails("echo sekrit_value_42"), {} as never, log);

  const json = JSON.stringify(records);
  assert.ok(!json.includes("sekrit"));
  assert.ok(!json.includes("echo"));
});

test("shutdown disposes the link", () => {
  const svc = fakeService();
  const pi = startWith(svc);
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  pi.emit("session_shutdown", {});
  assert.equal(svc.disposedCount(), 1);
});

test("an unexpected throw inside authorize defers", async () => {
  const svc = fakeService();
  const pi = startWith(svc);
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  const { log } = fakeLog();

  const verdict = await svc.link("system-one")!(null as never, {} as never, log);

  assert.deepEqual(verdict, { kind: "defer" });
});

test("typesafe reads its key from the registry captured at session_start", async () => {
  process.env.SYSTEM_ONE_GATE_BACKEND = "typesafe";
  const svc = fakeService();
  const pi = startWith(svc);
  const { fn, calls } = fakeFetch("safe", 0.95);
  globalThis.fetch = fn;
  pi.emit("session_start", {}, {
    modelRegistry: { getApiKeyForProvider: async () => "ts-key" },
  });
  pi.emitChannel(PERMISSIONS_READY_CHANNEL, { sessionId: SESSION });
  const { log } = fakeLog();

  const verdict = await svc.link("system-one")!(bashDetails("ls"), {} as never, log);

  assert.deepEqual(verdict, { kind: "allow" });
  assert.equal(calls[0].url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(calls[0].headers.Authorization, "Bearer ts-key");
});
