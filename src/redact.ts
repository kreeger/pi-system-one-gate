/**
 * Best-effort redaction of secret-looking text before it leaves the machine.
 *
 * Passes run in a fixed order, and each pass is idempotent on its own output,
 * so the whole function is idempotent. A miss means a secret is sent; the
 * tests pin the shapes this covers.
 */

const REDACTED = "<redacted>";

const QUOTED_OR_BARE = `("[^"]*"|'[^']*'|\\S+)`;

/** Ordered passes. Each takes the match and returns its replacement. */
const PASSES: ReadonlyArray<readonly [RegExp, string]> = [
  // scheme://user:pass@host -> scheme://<redacted>@host. The greedy run stops
  // at the last @ before a slash or space, so a password containing @ is covered.
  [/([a-z][a-z0-9+.-]*:\/\/)[^\s/]*@/gi, `$1${REDACTED}@`],
  // NAME=value at a token start (start of text or after whitespace). A = inside
  // a path, like /tmp/a=b, has a / before it and is not an assignment.
  [new RegExp(`(^|\\s)([A-Za-z_][A-Za-z0-9_]*)=${QUOTED_OR_BARE}`, "g"), `$1$2=${REDACTED}`],
  // --token VALUE, --token=VALUE, and the other named secret flags.
  [
    new RegExp(
      `(--(?:token|password|passwd|secret|api-key|apikey)(?:=|\\s+))${QUOTED_OR_BARE}`,
      "gi",
    ),
    `$1${REDACTED}`,
  ],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, REDACTED],
  [/\bAKIA[0-9A-Z]{16}\b/g, REDACTED],
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`],
];

/** A 32+ char run with both a letter and a digit is treated as a credential. */
const LONG_MIXED_RUN = /[A-Za-z0-9_+/=-]{32,}/g;

export function redactForReview(text: string): string {
  let out = text;
  for (const [pattern, replacement] of PASSES) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(LONG_MIXED_RUN, (run) =>
    /[A-Za-z]/.test(run) && /[0-9]/.test(run) ? REDACTED : run,
  );
}
