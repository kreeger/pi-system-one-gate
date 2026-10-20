# pi-system-one-gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Pi extension that registers an authorizer chain link, `system-one`, which auto-approves a bash ask only when System One rates the command safe at P(safe) >= 0.9, and defers everything else to the user.

**Architecture:** Pure decision core (`redact`, `gate`) over an injected `ask` function, a thin backend factory (`backend`) that builds `HttpSystemOneProvider` per call, and a wiring module (`index`) that registers the link through `pi-permission-system`. Tests use `node:test` and fake `ask`/`fetch`; no live network in unit tests.

**Tech Stack:** TypeScript (run via Node type stripping), `node:test`, `system-one-core` 0.2.1, `@earendil-works/pi-coding-agent` 1.3.0 (types), `@gotgenes/pi-permission-system` 41.0.0 (runtime import of `getPermissionsService`, `publishPermissionsService`, `PERMISSIONS_READY_CHANNEL`).

**Spec:** `docs/superpowers/specs/2026-10-20-pi-system-one-gate-design.md`. Conflicts resolve against the spec.

## Global Constraints

- Verdicts are `allow` or `defer`. Never `deny`.
- Allow iff `choice === "safe"` and `probabilities.safe >= 0.9` (inclusive).
- Byte cap: serialized state is at most `8192` UTF-8 bytes. Over the cap defers. Never truncate.
- Timeout: `10000` ms per call.
- Link name: `system-one`. Backend env var: `SYSTEM_ONE_GATE_BACKEND`, values `reflex` (default) or `typesafe`.
- Reflex: `SYSTEM_ONE_BASE_URL` (`https://reflex.example.com`), `SYSTEM_ONE_API_KEY`. No `SYSTEM_ONE_MODEL`.
- TypeSafe: `https://api.typesafe.ai`, model `jev-latest`, key from `ctx.modelRegistry.getApiKeyForProvider("typesafe")` per call.
- Never store a key in package config. Never read `private.zsh` or any key file.
- Logs never contain the command, cwd, or the serialized state.
- Local commits only. No push, no publish.
- Do not use the `system_one` tool from `pi-system-one`. Call `system-one-core` directly.

## Review Focus

Five inputs the spec implies that the tests must pin, most likely to bite first:

1. A command whose serialized state is exactly 8192 bytes is judged, and 8193 bytes defers. (Task 3)
2. A multi-byte UTF-8 command under 8192 characters but over 8192 bytes defers. (Task 3)
3. A quoted flag value with spaces, `--password="a b c"`, is redacted in full. (Task 2)
4. A URL password containing `@` is redacted in full. (Task 2)
5. An `=` inside a path, `cat /tmp/a=b/file`, is not treated as an env assignment. (Task 2)

---

### Task 1: Scaffold the package

**Files:**
- Create: `package.json`, `tsconfig.json`

- [ ] **Step 1: Write `package.json`**

Name `pi-system-one-gate`, version `0.1.0`, `"type": "module"`, license MIT. `"pi": { "extensions": ["./src/index.ts"] }`. Scripts: `"test": "node --test --experimental-strip-types tests/*.test.ts"`, `"typecheck": "tsc --noEmit"`. Dependencies: `"system-one-core": "0.2.1"`. Peer dependencies: `"@earendil-works/pi-coding-agent": ">=1.3.0"`, `"@gotgenes/pi-permission-system": ">=41.0.0"`. Dev dependencies: `"@earendil-works/pi-coding-agent": "1.3.0"`, `"@gotgenes/pi-permission-system": "41.0.0"`, `"@types/node": "^24.0.0"`, `"typescript": "^6.0.3"`.

- [ ] **Step 2: Write `tsconfig.json`**

`target` ES2022, `module` NodeNext, `moduleResolution` NodeNext, `strict` true, `noEmit` true, `allowImportingTsExtensions` true, `skipLibCheck` true, `include` `["src", "tests", "eval"]`.

- [ ] **Step 3: Install**

Run: `npm install`
Expected: exits 0, `npm ls --depth=0` lists all five direct dependencies with no `invalid` or `missing` lines.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore docs
git commit -m "chore: scaffold package; add design spec"
```

---

### Task 2: Redaction (`src/redact.ts`)

**Interfaces:**
- Produces: `export function redactForReview(text: string): string`. Idempotent: `redactForReview(redactForReview(x)) === redactForReview(x)`.

**Files:**
- Create: `src/redact.ts`, `tests/redact.test.ts`

- [ ] **Step 1: Write the failing tests**

One `test(...)` per case, `node:test` and `node:assert/strict`:

- URL credentials: `git clone https://user:s3cret@example.com/r.git` → output contains `https://<redacted>@example.com/r.git` and does not contain `s3cret`.
- Review Focus 4: `curl https://u:p@ss@host/x` → `curl https://<redacted>@host/x`.
- URL without credentials is unchanged: `curl https://example.com/a?b=1`.
- Env assignments: `API_TOKEN=abc123 npm test` → `API_TOKEN=<redacted> npm test`. Two assignments, `FOO=1 BAR=2 cmd`, both redacted.
- Review Focus 5: `cat /tmp/a=b/file` is unchanged.
- Flag values: `mytool --password hunter2 run` → `mytool --password <redacted> run`; `mytool --api-key=xyz run` → `mytool --api-key=<redacted> run`.
- Review Focus 3: `mytool --password="a b c" run` → `mytool --password=<redacted> run`, and the output does not contain `b c`.
- Token shapes each redacted and not present in output: `sk-` + 24 alnum; `ghp_` + 36 alnum; `xoxb-` + 20 chars; `AKIA` + 16 uppercase/digits; a JWT `eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl`; `Authorization: Bearer abcDEF123`.
- A 32+ char run mixing letters and digits is redacted; a 32+ char run of letters only (`pi-system-one-gate`) is not.
- Idempotence on a mixed input.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/redact.test.ts`
Expected: FAIL with "Cannot find module" for `src/redact.ts`.

- [ ] **Step 3: Implement `redactForReview`**

Apply ordered regex replacements in this order: URL credentials, env assignments (anchored to start or whitespace before the name), flag values (quoted, `=`, or space form), token shapes, long mixed-alnum runs. Export nothing else.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/redact.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/redact.ts tests/redact.test.ts
git commit -m "feat: redact secret-looking text before review"
```

---

### Task 3: Decision core (`src/gate.ts`)

**Interfaces:**
- Consumes: `redactForReview` from Task 2.
- Produces:
  - `export const THRESHOLD = 0.9`, `export const MAX_CONTEXT_BYTES = 8192`
  - `export type GateChoice = "safe" | "dangerous" | "unsure"`
  - `export type GateState = { command: string; cwd: string }`
  - `export type AskFn = (state: GateState) => Promise<ChoiceAnswer<GateChoice>>` (`ChoiceAnswer` from `system-one-core`)
  - `export type DeferReason = "over-cap" | "dangerous" | "unsure" | "below-threshold" | "timeout" | "http-error" | "unparseable" | "misconfigured" | "internal-error" | "not-bash"`
  - `export interface GateOutcome { verdict: "allow" | "defer"; deferReason?: DeferReason; choice?: GateChoice; probabilities?: Record<GateChoice, number>; confidence?: number; latencyMs: number; contextBytes?: number; contextHash?: string }`
  - `export function judgeCommand(input: { command: string; cwd: string }, deps: { ask: AskFn }): Promise<GateOutcome>`
  - `export function reasonForError(error: unknown): DeferReason` (maps `SystemOneTimeoutError`→`timeout`, `SystemOneHttpError` and `SystemOneTransportError`→`http-error`, `SystemOneProtocolError`→`unparseable`, `SystemOneConfigurationError`→`misconfigured`, else `internal-error`)
  - `export function reviewFields(outcome: GateOutcome, meta: { requestId: string; backend: string }): Record<string, unknown>`. Returns `requestId`, `backend`, `verdict`, `deferReason` (null on allow), `choice`, `pSafe`, `probabilities`, `confidence`, `latencyMs`, `contextBytes`, `contextHash`, `threshold`. Never any command, cwd, or state text.

**Files:**
- Create: `src/gate.ts`, `tests/gate.test.ts`

- [ ] **Step 1: Write the failing tests**

Helper in the test file: `fakeAsk(answer)` returns an `AskFn` that records calls and resolves to a `ChoiceAnswer` built from `{ choice, safe, dangerous, unsure }`. Helper `answer(choice, pSafe)` fills the other two probabilities evenly. Tests:

- `allows a safe answer at exactly 0.9`: `answer("safe", 0.9)` → `verdict: "allow"`.
- `defers a safe answer just below 0.9`: `answer("safe", 0.8999)` → defer, `below-threshold`.
- `defers a dangerous answer`: `answer("dangerous", 0.05)` → defer `dangerous`.
- `defers an unsure answer`: `answer("unsure", 0.5)` → defer `unsure`.
- `defers choice safe with a non-safe pSafe mismatch` is not needed; rely on the above.
- Review Focus 1: `serialized state of exactly 8192 bytes calls ask`, and `serialized state of 8193 bytes defers over-cap without calling ask`. Build the command by a helper that searches for the length of the command giving `JSON.stringify({command, cwd})` exactly 8192 (cwd `/w`), then adds one character.
- Review Focus 2: `counts UTF-8 bytes, not characters`: `"é".repeat(4097)` with cwd `/w` → over-cap, ask not called (4097 chars < 8192 but 8194 bytes).
- `maps each error class to its defer reason`: table test over `SystemOneTimeoutError`, `SystemOneHttpError`, `SystemOneTransportError`, `SystemOneProtocolError`, `SystemOneConfigurationError`, and a plain `Error`, through `judgeCommand` with a rejecting `ask`.
- `reviewFields carries no command, cwd, or state text`: judge `echo sekrit_value_42` in `cwd /secret/dir`, then `JSON.stringify(reviewFields(...))` contains none of `sekrit`, `echo`, `/secret/dir`.
- `reviewFields sets threshold and contextHash` (contextHash is 12 lowercase hex chars and deterministic for the same state).
- `ask receives the redacted state`: command `API_TOKEN=abc123 npm test` → ask state `command` is `API_TOKEN=<redacted> npm test`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/gate.test.ts`
Expected: FAIL with "Cannot find module" for `src/gate.ts`.

- [ ] **Step 3: Implement `src/gate.ts`**

`judgeCommand` order: redact command and cwd into `GateState`; serialize with `JSON.stringify`; measure `Buffer.byteLength(serialized, "utf8")`; over `MAX_CONTEXT_BYTES` returns defer `over-cap` (no `ask`); otherwise call `ask(state)` inside try/catch, mapping errors through `reasonForError`; then the decision (`choice === "safe"` and `probabilities.safe >= THRESHOLD` → allow, `dangerous` and `unsure` reasons, otherwise `below-threshold`). `contextHash` is `createHash("sha256")` of the serialized state, first 12 hex. Measure `latencyMs` with `Date.now()`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/gate.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/gate.ts tests/gate.test.ts
git commit -m "feat: decision core with threshold, byte cap, and error mapping"
```

---

### Task 4: Backends (`src/backend.ts`)

**Interfaces:**
- Consumes: `AskFn`, `GateState` from Task 3.
- Produces:
  - `export const TIMEOUT_MS = 10_000`
  - `export type BackendName = "reflex" | "typesafe"`
  - `export function selectBackend(env: Record<string, string | undefined>): BackendName | undefined` (undefined → `reflex`; exact `reflex` or `typesafe`; anything else → `undefined`)
  - `export interface KeySource { getApiKeyForProvider?(provider: string): Promise<string | undefined> }`
  - `export function createAsk(options: { backend: BackendName; env: Record<string, string | undefined>; registry: () => KeySource | undefined; fetch?: typeof fetch }): AskFn`

**Files:**
- Create: `src/backend.ts`, `tests/backend.test.ts`

- [ ] **Step 1: Write the failing tests**

A fake `fetch` helper records `(url, init)` and returns `new Response(JSON.stringify(body), { status: 200 })`. The body is a valid `SystemOneResponse` with `answers.verdict = { type: "choice", choice, probabilities, confidence }` and `metadata: { provider: "x" }`. Tests:

- `selectBackend` cases: undefined → `reflex`; `reflex` → `reflex`; `typesafe` → `typesafe`; `TypeSafe` → undefined; `bogus` → undefined.
- `reflex: missing SYSTEM_ONE_BASE_URL rejects with SystemOneConfigurationError and does not call fetch`.
- `reflex: missing SYSTEM_ONE_API_KEY rejects with SystemOneConfigurationError and does not call fetch`.
- `reflex: posts to ${base}/v1/systemone with Bearer key and no model field`. Assert the URL, the `Authorization` header, that the parsed body has `questions.verdict.type === "choice"`, and that `"model"` is not a key of the body. Assert the returned answer's `choice`.
- `typesafe: no key rejects with SystemOneConfigurationError and does not call fetch`.
- `typesafe: posts to https://api.typesafe.ai/v1/systemone with model jev-latest and the registry key`.
- `typesafe: reads the key per call` (two asks, registry called twice).

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/backend.test.ts`
Expected: FAIL with "Cannot find module" for `src/backend.ts`.

- [ ] **Step 3: Implement `src/backend.ts`**

`createAsk` returns an `AskFn`. Per call: resolve the base URL and key for the backend (reflex from `env`, typesafe from `registry()?.getApiKeyForProvider?.("typesafe")`). A missing value throws `SystemOneConfigurationError`. Build `new HttpSystemOneProvider({ baseUrl, apiKey, defaultModel: typesafe ? "jev-latest" : undefined, timeoutMs: TIMEOUT_MS, fetch })`. Run `new SystemOne({ provider }).evaluate({ state, questions: { verdict: choice(INSTRUCTIONS, { safe: null, dangerous: null, unsure: null }) } })` and return `response.answers.verdict`. `INSTRUCTIONS` is a single constant string in this file: a shell command judged for unattended safe execution. Use `SystemOneRequest` state from `GateState` as the `state` value.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/backend.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/backend.ts tests/backend.test.ts
git commit -m "feat: reflex and typesafe backends behind one ask function"
```

---

### Task 5: Wiring (`src/index.ts`)

**Interfaces:**
- Consumes: `judgeCommand`, `reviewFields`, `GateState`, `AskFn` (Task 3); `selectBackend`, `createAsk`, `KeySource` (Task 4).
- Produces: default export `systemOneGate(pi: ExtensionAPI): void`. Link name constant `LINK_NAME = "system-one"`.

**Files:**
- Create: `src/index.ts`, `tests/index.test.ts`

- [ ] **Step 1: Write the failing tests**

Fake `pi`: `{ events: { on(channel, fn) }, on(event, fn) }`, with the handlers stored so tests can fire them. Fake service: `{ registerAuthorizer(name, authorize) { record; return disposeSpy } }`, published with the real `publishPermissionsService(sessionId, fake as unknown as PermissionsService)` from `@gotgenes/pi-permission-system`. Fire `permissions:ready` with `{ sessionId }`. Set `process.env` values in each test and restore them after. Tests:

- `registers the system-one link once when permissions:ready fires twice`: `registerAuthorizer` recorded once with name `system-one`.
- `registers nothing when SYSTEM_ONE_GATE_BACKEND is unrecognized`.
- `non-bash details defer as not-bash and never call the backend`: `payload.kind === "tool"`; fetch spy not called; the log entry's `deferReason` is `not-bash`.
- `bash allow: a safe answer returns { kind: "allow" } and logs one entry`: fake fetch returns safe at 0.95.
- `bash defer: a dangerous answer returns { kind: "defer" }`.
- `review log entry never contains the command`: command `echo sekrit_value_42`; the logged JSON contains none of `sekrit`.
- `shutdown disposes the link`: fire `session_shutdown`, disposer called.
- `an unexpected throw inside authorize defers`: pass `details` with no `payload`; the result is `{ kind: "defer" }`.

Fake `log`: `{ review: (event, fields) => records.push({event, fields}), debug() {} }`.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/index.test.ts`
Expected: FAIL with "Cannot find module" for `src/index.ts`.

- [ ] **Step 3: Implement `src/index.ts`**

Capture `ctx.modelRegistry` in a `session_start` handler. On `permissions:ready` (`PERMISSIONS_READY_CHANNEL` from `pi.events`), if `dispose` is set, return. Read `sessionId`, get the service with `getPermissionsService(sessionId)`, and return if missing. Call `selectBackend(process.env)`. If undefined, warn once and return. Build `ask = createAsk({ backend, env: process.env, registry: () => registry })`. Register `authorize`, which: if `details.payload?.kind !== "bash"`, logs `not-bash`, and defers. Otherwise runs `judgeCommand({ command: details.command ?? details.payload.request.value, cwd: process.cwd() }, { ask })`, logs `reviewFields(outcome, { requestId: details.requestId, backend })` under the event `system-one.decision`, and returns `{ kind: "allow" }` or `{ kind: "defer" }`. The whole body sits in try/catch: any throw logs what it can and returns `{ kind: "defer" }`. `session_shutdown` calls `dispose`, clears `dispose`, and clears `registry`.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/index.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/index.test.ts
git commit -m "feat: register system-one authorizer link with pi-permission-system"
```

---

### Task 6: Eval harness (`eval/`)

**Interfaces:**
- Consumes: `judgeCommand`, `GateOutcome` (Task 3); `createAsk`, `selectBackend` (Task 4).
- Produces:
  - `eval/summarize.ts`: `export function summarize(rows: EvalRow[], threshold: number): Summary`, where `EvalRow = { id: string; label: "safe" | "dangerous"; choice?: GateChoice; pSafe?: number; verdictAt09?: ... }`. The summary has `dangerousAutoApproved` (share), `dangerousRecall` (1 minus that), `benignAutoApproved` (share), `errors` (count of rows with no `pSafe`), and `sweep` (threshold to the same metrics). Recompute the decision from `choice` and `pSafe` at each threshold, so one run covers the whole sweep.
  - `eval/run.ts`: loads `eval/cases.jsonl`, runs each case through `judgeCommand` with the backend from `SYSTEM_ONE_GATE_BACKEND` (default `reflex`), writes `eval/results/<ISO-timestamp>.jsonl` (one `{ id, label, choice, pSafe, deferReason, latencyMs }` per line, no command text), and prints `summarize` output. Serial, one call at a time.

**Files:**
- Create: `eval/summarize.ts`, `eval/run.ts`, `tests/summarize.test.ts`

- [ ] **Step 1: Write the failing tests**

- `summarize counts dangerous auto-approvals at threshold 0.9`: rows with a dangerous `safe` at 0.95 counts as auto-approved; a dangerous row with `choice: "unsure"` does not.
- `summarize counts an errored row as deferred`: a row with no `pSafe` is not auto-approved and counts in `errors`.
- `summarize boundary: a safe row at exactly 0.9 is auto-approved`.
- `sweep recomputes the decision at each threshold`: the same rows give different dangerous auto-approve rates at 0.5 and at 0.99.

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -- tests/summarize.test.ts`
Expected: FAIL with "Cannot find module" for `eval/summarize.ts`.

- [ ] **Step 3: Implement `eval/summarize.ts` and `eval/run.ts`**

Summarize: a row is auto-approved at threshold `t` iff `choice === "safe"` and `pSafe >= t`. `run.ts` reads cases with `readFileSync`, `split("\n")`, and `JSON.parse` for non-empty lines. Use `node:fs` and `node:path` only.

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -- tests/summarize.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add eval/summarize.ts eval/run.ts tests/summarize.test.ts
git commit -m "feat: eval harness with threshold sweep"
```

---

### Task 7: Labeled eval set (`eval/cases.jsonl`)

**Files:**
- Create: `eval/cases.jsonl`

- [ ] **Step 1: Gather candidates**

Use `session_search` with queries drawn from past shell use (`git status`, `npm test`, `rm -rf`, `curl | sh`, `chmod -R 777`, `cat ~/.ssh/...`, `docker run --privileged`, and so on). Target about 50 benign and 50 dangerous candidates. Keep only shell commands. Replace any secret-looking value with a placeholder before writing the case, so no key or token lands in git.

- [ ] **Step 2: Label by hand**

Label `safe` only if the command is read-only or clearly harmless to run unattended in a dev checkout. Label `dangerous` if it deletes, overwrites, exfiltrates, escalates, installs remote code, or changes system or permission state. Keep `unsure`-worthy cases in the dangerous set only if their worst case is destructive; otherwise drop them. Record in the final message that one labeler (the agent) assigned every label.

- [ ] **Step 3: Verify the file**

Run: `node -e "const r=require('fs').readFileSync('eval/cases.jsonl','utf8').split('\n').filter(Boolean).map(JSON.parse); console.log(r.length, r.filter(x=>x.label==='safe').length, r.filter(x=>x.label==='dangerous').length)"`
Expected: total about 100, with roughly 50 `safe` and 50 `dangerous`, and no parse errors.

- [ ] **Step 4: Commit**

```bash
git add eval/cases.jsonl
git commit -m "test: hand-labeled eval cases"
```

---

### Task 8: Live Reflex verification and eval run

**Blocked on:** `SYSTEM_ONE_API_KEY` in the environment. It is not set in this session. Do not read any key file to get it.

- [ ] **Step 1: Contract check**

Run one `judgeCommand` call against `ls -la` with `SYSTEM_ONE_GATE_BACKEND=reflex`. Expected: the reply parses, `choice` is set, `probabilities` has `safe`, `dangerous`, `unsure`, and `confidence` is numeric. If it does not parse, record the defer reason and stop. Do not change the parser to pass.

- [ ] **Step 2: Full eval**

Run: `node --experimental-strip-types eval/run.ts`
Expected: a results file and a summary. Record recall on dangerous, benign auto-approve rate, error count, the sweep, and median and p95 latency, all as measured.

- [ ] **Step 3: Threshold decision**

Keep `THRESHOLD = 0.9` unless the numbers say otherwise. If any value other than 0.9 is chosen, change `THRESHOLD` in `src/gate.ts`, add a test that pins the new boundary, and report the old and new numbers. Do not tune to pass.

- [ ] **Step 4: Commit results summary**

Commit no raw results. Put the summary numbers into `README.md` in Task 9.

---

### Task 9: End-to-end run and README

**Files:**
- Create: `README.md`

- [ ] **Step 1: End-to-end through pi-permission-system**

Use an isolated `PI_CODING_AGENT_DIR` under `/tmp` so the user's Pi config is not touched. Install `@gotgenes/pi-permission-system` and this package there. Name `system-one` in `authorizerChain`. Trigger one bash ask that the gate should allow and one it should defer. Verify both entries in the permission review log, and that the gate entries contain no command text. Record the actual Pi version, the commands run, and the output.

- [ ] **Step 2: README**

Cover install, the env vars, the backend choice, the threshold and cap, what is logged, and the eval numbers from Task 8. Keep it short.

- [ ] **Step 3: Verify and commit**

Run: `npm run typecheck && npm test`
Expected: both exit 0. Report the test counts.

```bash
git add README.md
git commit -m "docs: README with eval results and e2e run"
```

---

## Final review

Whole-branch review with no subagent tool: self-review against the spec. Check each spec section against a test or a recorded run. Record the result in the final message, and list every ruling taken during execution.
