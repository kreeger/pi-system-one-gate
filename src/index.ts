/**
 * Entry point: register the `system-one` authorizer chain link with
 * pi-permission-system. The link decides nothing until the operator names
 * `system-one` in `authorizerChain`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type AuthorizerVerdict,
  getPermissionsService,
  PERMISSIONS_READY_CHANNEL,
  type PromptPermissionDetails,
} from "@gotgenes/pi-permission-system";

import { type BackendName, createAsk, type KeySource, MCP_INSTRUCTIONS, selectBackend } from "./backend.ts";
import { judgeCommand, reviewFields } from "./gate.ts";
import { judgeMcpCall } from "./mcp-gate.ts";

/** The operator-facing chain-link name referenced from `authorizerChain`. */
const LINK_NAME = "system-one";

const DECISION_EVENT = "system-one.decision";

export default function systemOneGate(pi: ExtensionAPI): void {
  let registry: KeySource | undefined;
  let dispose: (() => void) | undefined;

  pi.on("session_start", (_event, ctx) => {
    registry = ctx.modelRegistry;
  });

  pi.events.on(PERMISSIONS_READY_CHANNEL, (event) => {
    // Idempotent: ready fires at least once per session and may repeat.
    if (dispose) return;
    const sessionId = (event as { sessionId?: unknown } | undefined)?.sessionId;
    if (typeof sessionId !== "string") return;
    const service = getPermissionsService(sessionId);
    if (!service) return;

    const backend = selectBackend(process.env);
    if (backend === undefined) {
      console.warn(
        `pi-system-one-gate: unknown SYSTEM_ONE_GATE_BACKEND "${process.env.SYSTEM_ONE_GATE_BACKEND}"; link not registered.`,
      );
      return;
    }
    dispose = service.registerAuthorizer(LINK_NAME, authorize(backend));
  });

  pi.on("session_shutdown", () => {
    dispose?.();
    dispose = undefined;
    registry = undefined;
  });

  function authorize(backend: BackendName) {
    const ask = createAsk({ backend, env: process.env, registry: () => registry });
    const askMcp = createAsk({
      backend,
      env: process.env,
      registry: () => registry,
      instructions: MCP_INSTRUCTIONS,
    });
    return async (
      details: PromptPermissionDetails,
      _query: unknown,
      log: { review(event: string, fields?: Record<string, unknown>): void },
    ): Promise<AuthorizerVerdict> => {
      try {
        if (details.payload.kind === "mcp") {
          const outcome = await judgeMcpCall(
            {
              target: details.payload.request.value,
              toolName: details.payload.request.toolName ?? details.payload.request.value,
              evidence: details.payload.evidence,
              cwd: process.cwd(),
            },
            { ask: askMcp },
          );
          log.review(DECISION_EVENT, reviewFields(outcome, { requestId: details.requestId, backend }));
          return outcome.verdict === "allow" ? { kind: "allow" } : { kind: "defer" };
        }
        if (details.payload.kind !== "bash") {
          log.review(DECISION_EVENT, reviewFields(
            { verdict: "defer", deferReason: "not-bash", latencyMs: 0, contextBytes: 0, contextHash: "" },
            { requestId: details.requestId, backend },
          ));
          return { kind: "defer" };
        }
        const command = details.command ?? details.payload.request.value;
        const outcome = await judgeCommand({ command, cwd: process.cwd() }, { ask });
        log.review(DECISION_EVENT, reviewFields(outcome, { requestId: details.requestId, backend }));
        return outcome.verdict === "allow" ? { kind: "allow" } : { kind: "defer" };
      } catch {
        return { kind: "defer" };
      }
    };
  }
}
