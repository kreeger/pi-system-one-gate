import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  getPermissionsService,
  PERMISSIONS_READY_CHANNEL,
  type PermissionsService,
  publishPermissionsService,
  unpublishPermissionsService,
} from "@gotgenes/pi-permission-system";

import systemOneGate from "../src/index.ts";

// Guard for upgrades: pi-permission-system has shipped breaking changes in
// minor-looking bumps, so a new major must be reviewed before it is accepted.
const SUPPORTED_MAJOR = 41;

function majorOf(version: string): number {
  return Number(version.split(".")[0]);
}

const here = dirname(fileURLToPath(import.meta.url));
const installed = JSON.parse(
  readFileSync(
    join(here, "..", "node_modules", "@gotgenes", "pi-permission-system", "package.json"),
    "utf8",
  ),
) as { version: string };

test("the installed pi-permission-system is the supported major", () => {
  assert.equal(majorOf(installed.version), SUPPORTED_MAJOR, `installed ${installed.version}`);
});

test("the major check rejects a newer major", () => {
  assert.notEqual(majorOf("42.0.0"), SUPPORTED_MAJOR);
});

test("the exports this gate calls are present", () => {
  assert.equal(typeof getPermissionsService, "function");
  assert.equal(typeof publishPermissionsService, "function");
  assert.equal(typeof unpublishPermissionsService, "function");
  assert.equal(typeof PERMISSIONS_READY_CHANNEL, "string");
});

test("registration works through the real service registry", () => {
  const sessionId = "contract-session";
  const registered: string[] = [];
  let authorize: unknown;
  const service = {
    registerAuthorizer(name: string, fn: unknown) {
      registered.push(name);
      authorize = fn;
      return () => {};
    },
  } as unknown as PermissionsService;

  const handlers = new Map<string, (event: unknown) => void>();
  const pi = {
    events: { on: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn) },
    on: () => {},
  } as never;

  publishPermissionsService(sessionId, service);
  try {
    systemOneGate(pi);
    handlers.get(PERMISSIONS_READY_CHANNEL)?.({ sessionId });
    assert.deepEqual(registered, ["system-one"]);
    assert.equal(typeof authorize, "function");
  } finally {
    unpublishPermissionsService(sessionId, service);
  }
});
