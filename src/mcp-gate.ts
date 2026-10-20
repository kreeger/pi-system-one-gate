/**
 * MCP pre-checks: a write-verb name list and the input evidence the authorizer
 * receives. Pure. The judge that uses them is added alongside the shared core.
 */

export const WRITE_VERBS: readonly string[] = [
  "delete",
  "remove",
  "destroy",
  "drop",
  "send",
  "post",
  "create",
  "update",
  "write",
  "set",
  "put",
  "patch",
  "exec",
  "run",
];

/** The first write verb that is a whole token of the name, lowercased. */
export function writeVerbOf(name: string): string | undefined {
  const tokens = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  return tokens.find((token) => WRITE_VERBS.includes(token));
}

/** The text of the `input` evidence entry, or undefined when the formatter gave none. */
export function mcpInputOf(
  evidence: ReadonlyArray<{ label: string; text: string }>,
): string | undefined {
  return evidence.find((entry) => entry.label === "input")?.text;
}
