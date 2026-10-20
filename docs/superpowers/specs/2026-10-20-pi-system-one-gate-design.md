# pi-system-one-gate design

Date: 2026-10-20. Status: settled design from the user, written up as the v1 spec.

## Problem

pi-permission-system asks the human for every bash command that no rule covers. Many of those are routine reads, builds, and listings. This extension lets System One approve the clearly safe ones and sends everything else to the human prompt.

## Behavior

- Registers an authorizer chain link named `system-one` through `getPermissionsService(sessionId).registerAuthorizer`. The link decides nothing until the operator names `system-one` in `authorizerChain`.
- Handles `bash` asks only. Every other surface returns `defer`.
- Verdicts are `allow` or `defer`. The gate never returns `deny`.
- `allow` only when System One's choice is `safe` and P(safe) >= 0.9.
- `defer` for everything else: choice `dangerous`, choice `unsure`, P(safe) below 0.9, and every failure.

## Request

- One question, key `verdict`: `choice(INSTRUCTIONS, { safe: null, dangerous: null, unsure: null })`.
- State: `{ command, cwd }`, both passed through `redactForReview`.
- `command` is the asking bash unit as typed: `details.command ?? details.payload.request.value`.
- `cwd` is `process.cwd()`.
- Size: the serialized state (`JSON.stringify`, UTF-8 bytes) must be at most 8192. Over the cap, defer with `over-cap` and make no call. Never truncate.

## Redaction (`src/redact.ts`)

Applied in this order, best effort:

1. URL credentials: `scheme://user:pass@host` becomes `scheme://<redacted>@host`.
2. Env assignments: a `NAME=value` token, where NAME matches `[A-Za-z_][A-Za-z0-9_]*`, becomes `NAME=<redacted>`.
3. Flag values: `--token`, `--password`, `--passwd`, `--secret`, `--api-key`, `--apikey`, as `--flag VALUE` or `--flag=VALUE`, lose their value.
4. Token shapes become `<redacted>`: `sk-...`, `gh[pousr]_...`, `xox[abprs]-...`, `AKIA[0-9A-Z]{16}`, JWTs (`eyJ...`.`...`.`...`), `Bearer <token>`, and any run of 32+ chars from `[A-Za-z0-9_+/=-]` that contains both a letter and a digit.

## Decision (`src/gate.ts`)

`judgeCommand(input, deps)` is pure over its injected `ask` function. Steps:

1. Build the redacted state and measure it. Over the cap: defer `over-cap`, no call.
2. Call `ask(state)`, which resolves to a `ChoiceAnswer`.
3. Allow iff `choice === "safe"` and `probabilities.safe >= THRESHOLD` (0.9, inclusive). Otherwise defer with `dangerous`, `unsure`, or `below-threshold`.
4. Map thrown errors to defer reasons:

| Error | Reason |
|---|---|
| `SystemOneTimeoutError` | `timeout` |
| `SystemOneHttpError`, `SystemOneTransportError` | `http-error` |
| `SystemOneProtocolError` (unparseable or invalid reply) | `unparseable` |
| `SystemOneConfigurationError` (missing key or endpoint) | `misconfigured` |
| anything else | `internal-error` |

Every defer reason is one of: `over-cap`, `dangerous`, `unsure`, `below-threshold`, `timeout`, `http-error`, `unparseable`, `misconfigured`, `internal-error`, `not-bash`.

## Logging

One `log.review("system-one.decision", ...)` entry per ask, including non-bash asks. Fields: `requestId`, `backend`, `verdict`, `deferReason`, `choice`, `pSafe`, `probabilities`, `confidence`, `latencyMs`, `contextBytes`, `contextHash` (first 12 hex of sha256 of the serialized state), `threshold`.

The entry never contains `command`, `cwd`, or the serialized state. pi-permission-system's own gate entry may still contain the command, because it logs the ask value. This gate does not add to that, and the eval checks that.

## Backends (`src/backend.ts`)

- Selected by `SYSTEM_ONE_GATE_BACKEND`: `reflex` (default) or `typesafe`. Any other value means the link is not registered, and one warning is printed.
- **Reflex:** base URL from `SYSTEM_ONE_BASE_URL`, key from `SYSTEM_ONE_API_KEY`, both read per call. A missing value throws `SystemOneConfigurationError`. The model is `SYSTEM_ONE_GATE_MODEL`, defaulting to `d3-mini`. Reflex rejects a request with no model (HTTP 422, `model: Field required`), so the original "no model field" rule did not hold. Verified against the live endpoint: `d3-mini` and `qwen/small` answer the choice question; `zeta` (no chat template) and `embedding` (not an LLM) do not.
- **TypeSafe:** base URL `https://api.typesafe.ai`, model `jev-latest`. The key comes from `ctx.modelRegistry.getApiKeyForProvider("typesafe")` on every call. The registry is captured at `session_start`. A missing key throws `SystemOneConfigurationError`. The key is never stored in package config.
- Both use `HttpSystemOneProvider` with `timeoutMs: 10000`, wrapped in `SystemOne`.

## Wiring (`src/index.ts`)

- `session_start`: capture `ctx.modelRegistry`.
- `permissions:ready` on `pi.events`: resolve `getPermissionsService(sessionId)` and register the link. A dispose guard makes repeats harmless.
- `authorize(details, _query, log)`: non-bash returns `defer`. Bash runs `judgeCommand`, logs, and maps `allow` to `{ kind: "allow" }` and everything else to `{ kind: "defer" }`. An unexpected throw defers.
- `session_shutdown`: dispose the link and clear the captured registry.

## Eval (`eval/`)

- `eval/cases.jsonl`: about 50 benign and 50 dangerous commands, each `{ id, label, command }`. Labels are hand-assigned.
- `eval/run.ts`: runs each case through `judgeCommand` with the selected backend and writes `eval/results/*.jsonl`, which is git-ignored. It prints recall on dangerous, benign auto-approve rate, error counts, and a threshold sweep from 0.50 to 0.99 using the stored `pSafe` values.
- Target: recall on dangerous >= 0.95. This is the same number as "<= 5% of dangerous commands auto-approved", so it is reported once.

## Verification

1. Unit tests (`node:test`, `MockSystemOneProvider`, fake fetch): threshold boundary, each defer reason, redaction, byte cap, no-command logging, non-bash defer, wiring.
2. Labeled eval against the real Reflex endpoint, with numbers reported as measured.
3. One end-to-end run through pi-permission-system with `system-one` in `authorizerChain`.

## Decisions beyond the settled design

0. Reflex model: `SYSTEM_ONE_GATE_MODEL`, default `d3-mini`. Chosen by the user after a live probe (see Backends).

1. `allow` requires `choice === "safe"` in addition to P(safe) >= 0.9. This is stricter, and the two conditions agree in practice.
2. The judged command is the asking unit, not the whole chain. The whole chain stays available to the framework's own review.
3. `cwd` is `process.cwd()`, not the session context cwd.
4. Backend selection is the env var `SYSTEM_ONE_GATE_BACKEND`. The settled design did not name a mechanism.
5. The link is named `system-one`.
6. The byte cap measures the serialized state, not the bare command.

## Open risks

- The 0.9 threshold is a starting guess. The eval reports the full sweep. A final value other than 0.9 is reported with its numbers and is not tuned to pass the target.
- The labeled set is small (50 safe, 49 dangerous), and one labeler (the author) assigned every label. Results are indicative.
- Reflex's `choice` reply shape was verified with a live call: it parses into `choice`, `probabilities`, and `confidence`. The `system-one-core` README was the only prior source for that shape.
- Redaction is best effort. With `typesafe`, the redacted command is sent to a third party.
- The Reflex host serves a certificate from a private root (`<path-to-root-ca>`). Node does not trust it by default, so the extension process needs `NODE_EXTRA_CA_CERTS` pointing at that file. This is an environment requirement, not something the package sets, and TLS verification is not disabled.
- The TypeSafe path is not exercised live. No TypeSafe key was used during development.
- The end-to-end run through `pi-permission-system` passed in a live Pi session (see README). It loaded both extensions with `-e`, since `pi-permission-system` is not installed in that Pi by default.
