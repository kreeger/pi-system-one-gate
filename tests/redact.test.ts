import assert from "node:assert/strict";
import { test } from "node:test";

import { redactForReview } from "../src/redact.ts";

test("redacts URL credentials and keeps the host", () => {
  const out = redactForReview("git clone https://user:s3cret@example.com/r.git");
  assert.equal(out, "git clone https://<redacted>@example.com/r.git");
  assert.ok(!out.includes("s3cret"));
});

test("redacts a URL password that contains @", () => {
  assert.equal(
    redactForReview("curl https://u:p@ss@host/x"),
    "curl https://<redacted>@host/x",
  );
});

test("leaves a URL without credentials unchanged", () => {
  assert.equal(
    redactForReview("curl https://example.com/a?b=1"),
    "curl https://example.com/a?b=1",
  );
});

test("redacts one env assignment", () => {
  assert.equal(
    redactForReview("API_TOKEN=abc123 npm test"),
    "API_TOKEN=<redacted> npm test",
  );
});

test("redacts every leading env assignment", () => {
  assert.equal(redactForReview("FOO=1 BAR=2 cmd"), "FOO=<redacted> BAR=<redacted> cmd");
});

test("does not treat an = inside a path as an env assignment", () => {
  assert.equal(redactForReview("cat /tmp/a=b/file"), "cat /tmp/a=b/file");
});

test("redacts a space-separated flag value", () => {
  assert.equal(
    redactForReview("mytool --password hunter2 run"),
    "mytool --password <redacted> run",
  );
});

test("redacts an =-separated flag value", () => {
  assert.equal(
    redactForReview("mytool --api-key=xyz run"),
    "mytool --api-key=<redacted> run",
  );
});

test("redacts a quoted flag value with spaces in full", () => {
  const out = redactForReview('mytool --password="a b c" run');
  assert.equal(out, "mytool --password=<redacted> run");
  assert.ok(!out.includes("b c"));
});

test("redacts each known token shape", () => {
  const cases = [
    "sk-abcdefghijklmnopqrstuvwx",
    "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "xoxb-1234567890-abcdefghij",
    "AKIAIOSFODNN7EXAMPLE",
    "eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl",
    "Authorization: Bearer abcDEF123",
  ];
  for (const secret of cases) {
    const out = redactForReview(`run ${secret} now`);
    assert.ok(!out.includes(secret), `leaked: ${secret}`);
    assert.ok(out.includes("<redacted>"), `not marked: ${secret}`);
  }
});

test("redacts a long run that mixes letters and digits", () => {
  const out = redactForReview("echo a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6");
  assert.ok(out.includes("<redacted>"));
});

test("does not redact a long run of letters only", () => {
  assert.equal(
    redactForReview("cd pi-system-one-gate-package-name-here"),
    "cd pi-system-one-gate-package-name-here",
  );
});

test("is idempotent", () => {
  const input =
    "API_TOKEN=abc123 curl https://u:p@host/x --password=\"a b\" sk-abcdefghijklmnopqrstuvwx";
  const once = redactForReview(input);
  assert.equal(redactForReview(once), once);
});
