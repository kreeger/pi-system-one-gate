# MCP tool gate design

Date: 2026-10-20. Status: draft for approval. Nothing is built until approved.

## Intent

pi-permission-system asks the human for every MCP tool call no rule covers. Many are read-only lookups. This extension lets System One approve the clearly safe ones and defers everything else, the same way it treats bash.

## Goals

- Judge `mcp` asks with System One. Auto-approve only `safe` at P(safe) >= 0.90.
- Fail closed. Every error, missing input, or doubt defers.
- Reuse the existing decision core, backends, redaction, and logging.

## Non-goals

- No `deny` verdicts. The gate never denies.
- No change to bash handling.
- No MCP server or tool discovery of our own.
- No new config keys beyond what the package already reads.

## Anti-goals

- Auto-approving a write or delete tool because its arguments look harmless.
- Judging a call on arguments the gate never saw without saying so.

## Facts this design rests on

Checked in `@gotgenes/pi-permission-system` 41.0.0 (`src/presentation/tool-ask-payload.ts`, `src/access-intent/mcp-targets.ts`, the built-in formatters) and `@earendil-works/pi-mcp` 1.3.0.

- An MCP ask arrives as `payload.kind === "mcp"`. `payload.request.value` is the qualified target (for example `server_tool`). `payload.request.toolName` is the MCP tool name.
- The authorizer does not receive raw MCP arguments. It receives `payload.evidence`, a preview built by the registered input formatter for that tool name.
- The built-in `mcp` formatter summarizes arguments to 160 characters, with each value cut to 60. A Pi MCP tool (`mcp__<server>__<tool>`) gets a preview only when a formatter is registered under its own name. None is registered by default, so by default the gate may see the target and no arguments.
- `payload.annotations` is always `[]` on the ask. The MCP tool annotations (`readOnlyHint`) exist as types in `pi-mcp`, but `pi-mcp` exposes no public API for them.
- `registerToolInputFormatter(toolName, formatter)` is public on the service, so the gate can register formatters for specific tool names. It cannot register a wildcard.

## Decisions

Recommended defaults the user approved, with one change forced by the facts above:

1. **Scope: judge all MCP asks.** Named-server-only is rejected. Every `kind: "mcp"` ask goes to System One.
2. **Allow rule: same as bash.** `choice === "safe"` and P(safe) >= 0.90, inclusive.
3. **Eval: same bar.** Hand-labeled MCP cases, dangerous auto-approved <= 5%. Ship only if the gate passes, or report the numbers without a pass/fail gate.
4. **Side effects: changed.** The approved default was "defer unless `readOnlyHint`". That is not buildable. Annotations do not reach the authorizer, and `pi-mcp` has no public accessor. Substitute, marked as my call:
   - Defer without a model call when the tool name contains a write verb: `delete`, `remove`, `destroy`, `drop`, `send`, `post`, `create`, `update`, `write`, `set`, `put`, `patch`, `exec`, `run`. Match on the tool-name segment after the server prefix, case-insensitive.
   - Otherwise, judge with System One.
   - Known miss: a write tool with a neutral name (for example `archive_item`) reaches the model. The model judges it, and that is the risk we accept.
   - Revisit if `pi-mcp` exposes annotations to other extensions.
5. **No arguments, no judgment.** If the ask has no `evidence` preview for the tool, defer with `no-input-preview` and make no call. The model never judges a bare target name.
6. **Formatter registration: out of scope for v1.** The gate does not register formatters. Arguments come from whatever pi-permission-system already previews. This means arguments longer than the formatter's caps are cut before the model sees them. That is a known gap, not a silent one. See Open risks.
7. **Logging.** Same `system-one.decision` event. The `command` field is replaced by `target`. The event does not contain the arguments or the serialized state.

## Request

- Bash keeps its current request and instructions unchanged.
- MCP uses a separate instruction set and state:
  - State: `{ target, input, cwd }`. `target` is `payload.request.value`. `input` is `payload.evidence` text. `cwd` is `process.cwd()`. All three pass through `redactForReview`.
  - One question, key `verdict`: `choice(MCP_INSTRUCTIONS, { safe, dangerous, unsure })`.
- Size cap: 8192 bytes of serialized state, as for bash. Over cap defers with `over-cap` and no call. Never truncate.

## Defer reasons

Existing reasons, plus two new ones:

- `no-input-preview`: MCP ask with no evidence. No call made.
- `write-verb`: target name matched the write-verb list. No call made.

## Wiring

- `details.payload.kind === "bash"`: existing path.
- `details.payload.kind === "mcp"`: MCP path. Build the MCP state, apply the no-preview and write-verb checks, then call System One.
- Any other kind: defer with `not-bash`, as today. Rename to `not-supported` only if approved.

## Files

- `src/mcp-gate.ts`: MCP state builder, write-verb check, instructions. Pure.
- `src/gate.ts`: shared `judgeCommand` logic. The state type becomes a union of bash and MCP.
- `src/index.ts`: route by `payload.kind`.
- `eval/mcp-cases.jsonl`: hand-labeled MCP cases, `{ id, label, target, input }`.
- `eval/run.ts`: run MCP cases when given `--mcp`.
- `tests/mcp-gate.test.ts`: write-verb matching, no-preview defer, over-cap, logging with no arguments, routing.

## Verification

1. Unit tests for each defer reason, the threshold boundary, and routing. Run `npm test`.
2. `npm run typecheck`.
3. MCP eval against the real backend, reported with the sweep.
4. One live Pi run with an MCP server configured, `system-one` in `authorizerChain`, showing one safe MCP call allowed and one write-verb call deferred.

## Open risks

- Arguments are truncated by the formatter (160 characters, 60 per value). The model may judge a call on a cut-off argument. Eval should include long-argument cases to measure this.
- The write-verb list is a heuristic. Neutral-named write tools reach the model.
- The eval set is small and hand-labeled by one person, as for bash.
- If an MCP server runs a write tool and the model says `safe`, nothing stops it. This is the same class of risk as bash, with less visibility.

## What's left to the builder

- Exact instruction text for MCP.
- Exact truncation marker detection, if the formatter adds one.
- Whether the decision log needs a `kind` field.

## Calls made in this draft (for the reviewer to check)

- Changed the side-effects default from annotations to the write-verb list (decision 4).
- Added `no-input-preview` as fail-closed (decision 5).
- Left formatter registration out of v1 (decision 6).
- Did not commit this file. Committing waits for approval.

## Builder check

No subagent tool is available in this session, so I read this as the builder. Open questions are listed above. None block the plan.
