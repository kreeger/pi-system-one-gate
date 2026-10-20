/**
 * Run the labeled cases through the real decision path, one call at a time.
 *
 *   SYSTEM_ONE_GATE_BACKEND=reflex npx tsx eval/run.ts
 *   SYSTEM_ONE_GATE_BACKEND=reflex npx tsx eval/run.ts --mcp
 *
 * Writes eval/results/<timestamp>.jsonl (no command text) and prints a summary.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createAsk, MCP_INSTRUCTIONS, selectBackend } from "../src/backend.ts";
import { judgeCommand } from "../src/gate.ts";
import { judgeMcpCall } from "../src/mcp-gate.ts";
import { type EvalRow, summarize } from "./summarize.ts";

interface Case {
  id: string;
  label: "safe" | "dangerous";
  command?: string;
  target?: string;
  input?: string;
}

const mcp = process.argv.includes("--mcp");

const here = dirname(fileURLToPath(import.meta.url));
const backend = selectBackend(process.env);
if (backend === undefined) {
  throw new Error(`unknown SYSTEM_ONE_GATE_BACKEND: ${process.env.SYSTEM_ONE_GATE_BACKEND}`);
}

const cases: Case[] = readFileSync(join(here, mcp ? "mcp-cases.jsonl" : "cases.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as Case);

const ask = createAsk({
  backend,
  env: process.env,
  registry: () => undefined,
  instructions: mcp ? MCP_INSTRUCTIONS : undefined,
});
const cwd = process.cwd();

const rows: Array<EvalRow & { deferReason: string | null; latencyMs: number }> = [];
for (const testCase of cases) {
  const outcome = mcp
    ? await judgeMcpCall(
        {
          target: testCase.target ?? "",
          toolName: testCase.target ?? "",
          evidence: [{ label: "input", text: testCase.input ?? "" }],
          cwd,
        },
        { ask },
      )
    : await judgeCommand({ command: testCase.command ?? "", cwd }, { ask });
  rows.push({
    id: testCase.id,
    label: testCase.label,
    choice: outcome.choice,
    pSafe: outcome.probabilities?.safe,
    deferReason: outcome.deferReason ?? null,
    latencyMs: outcome.latencyMs,
  });
  process.stderr.write(".");
}
process.stderr.write("\n");

const resultsDir = join(here, "results");
mkdirSync(resultsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = join(resultsDir, `${stamp}-${backend}.jsonl`);
writeFileSync(outPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

const summary = summarize(rows, 0.9);
const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b);
const pct = (p: number) => latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))];

console.log(`backend: ${backend}  cases: ${rows.length}  results: ${outPath}`);
console.log(`dangerous auto-approved @0.9: ${(summary.dangerousAutoApproved * 100).toFixed(1)}%  recall: ${(summary.dangerousRecall * 100).toFixed(1)}%`);
console.log(`benign auto-approved @0.9: ${(summary.benignAutoApproved * 100).toFixed(1)}%`);
console.log(`errors (no pSafe): ${summary.errors}`);
if (summary.errors > 0) {
  console.log(`WARNING: ${summary.errors} of ${rows.length} calls produced no answer; the rates above count them as deferred and are not a valid eval result.`);
}
console.log(`latency ms  median: ${pct(0.5)}  p95: ${pct(0.95)}`);
console.log("sweep (threshold: dangerous-auto / benign-auto):");
for (const point of summary.sweep) {
  console.log(`  ${point.threshold.toFixed(2)}: ${(point.dangerousAutoApproved * 100).toFixed(1)}% / ${(point.benignAutoApproved * 100).toFixed(1)}%`);
}
