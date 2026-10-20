# pi-system-one-gate

A Pi authorizer chain link for `pi-permission-system`. When a bash command would prompt you, it asks System One whether the command is safe. It auto-approves only commands rated safe at P(safe) >= 0.9. Everything else goes to your normal prompt. The gate never denies.

## Requirements

**`@gotgenes/pi-permission-system` is a hard dependency.** This package imports it at load time and registers its link through it, so it cannot run without it. Install it first:

```sh
pi install npm:@gotgenes/pi-permission-system
```

Without it, Pi fails to load this extension, and nothing else in this package works.

The link is registered as `system-one`. It does nothing until you name it:

```jsonc
// ~/.pi/agent/extensions/pi-permission-system/config.json
{
  "authorizerChain": ["system-one"]
}
```

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `SYSTEM_ONE_GATE_BACKEND` | `reflex` | `reflex` or `typesafe`. Any other value disables the link. |
| `SYSTEM_ONE_BASE_URL` | none | Reflex endpoint, e.g. `https://reflex.example.com`. |
| `SYSTEM_ONE_API_KEY` | none | Reflex bearer key. Read from the environment on every call. |
| `SYSTEM_ONE_GATE_MODEL` | `d3-mini` | Model sent to Reflex. Reflex rejects requests with no model. |
| `NODE_EXTRA_CA_CERTS` | none | Needed when the Reflex host uses a private CA. Set it to that root certificate. TLS verification stays on. |

With `typesafe`, the key comes from `/login typesafe` on each call. Nothing is stored in package config.

## Behavior

- Only bash asks are judged. Other surfaces defer.
- Allow only when the choice is `safe` and P(safe) >= 0.9.
- Dangerous, unsure, below-threshold, over-cap, and every error (timeout, HTTP, unparseable reply, missing key, internal error) defer.
- Serialized state is capped at 8192 UTF-8 bytes. Over the cap defers. Nothing is truncated.
- Secret-looking text is redacted before it is sent: URL credentials, `KEY=value` assignments, secret-named flags, and common token shapes.
- Each ask writes one `system-one.decision` entry to the permission review log: verdict, defer reason, choice, probabilities, latency, context size and hash, threshold. The command and cwd are never logged.

## Eval

`eval/cases.jsonl` holds 50 benign and 49 dangerous shell commands. One labeler (the author) assigned every label. Run it with:

```sh
SYSTEM_ONE_GATE_BACKEND=reflex npx tsx eval/run.ts
```

Results on `d3-mini` at the 0.9 threshold, 2026-10-20:

- Dangerous auto-approved: 0.0% (recall 100%). Target was at least 95% recall.
- Benign auto-approved: 86.0%. 43 allow, 7 defer (6 below-threshold, 1 unsure).
- Errors: 0 of 99. Median latency 371 ms.
- Threshold sweep from 0.50 to 0.99 kept dangerous auto-approval at 0% and benign approval between 98% and 46%.

The threshold stays at 0.9. The sweep was not used to pick it. The set is small and hand-labeled, so these numbers indicate behavior and do not guarantee it.

## Status

- Unit tests (48) cover redaction, the decision core, the backends, and the wiring. Run `npm test`.
- End-to-end, run in a live Pi (`pi -p`) with `system-one` in `authorizerChain`:
  - A benign `ls` was allowed by `system-one` (P(safe) 0.99, `decidedBy: authorizer`).
  - A dangerous `rm -rf` was deferred (`dangerous`, P(safe) 0.29). No UI was available, so Pi denied it, and the target file survived.
  - Both extensions were loaded with `-e`, since `pi-permission-system` is not installed in that Pi by default.
- The eval has 99 cases, not the 100 planned: 49 dangerous, 50 benign.
