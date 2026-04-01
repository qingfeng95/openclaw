import type { IncomingMessage, ServerResponse } from "node:http";
import { createOpenClawTools } from "../agents/openclaw-tools.js";
import { runBeforeToolCallHook } from "../agents/pi-tools.before-tool-call.js";
import { resolveToolLoopDetectionConfig } from "../agents/pi-tools.js";
import {
  resolveEffectiveToolPolicy,
  resolveGroupToolPolicy,
  resolveSubagentToolPolicy,
} from "../agents/pi-tools.policy.js";
import {
  collectExplicitAllowlist,
  mergeAlsoAllowPolicy,
  resolveToolProfilePolicy,
} from "../agents/tool-policy.js";
import {
  applyToolPolicyPipeline,
  buildDefaultToolPolicyPipelineSteps,
} from "../agents/tool-policy-pipeline.js";
import { ToolInputError } from "../agents/tools/common.js";
import { loadConfig } from "../config/config.js";
import { resolveMainSessionKey } from "../config/sessions.js";
import { logWarn } from "../logger.js";
import { resolveMemoryStorePathForScope } from "../multitenant/integration/memory-hook.js";
import { resolveToolExecutionPolicy } from "../multitenant/integration/openclaw-tools-hook.js";
import { resolveStoreKeyForScope } from "../multitenant/integration/sessions-hook.js";
import {
  resolveSafeUserPathForScope,
  resolveWorkspaceRootForScope,
} from "../multitenant/integration/workspace-hook.js";
import { runWithOptionalRuntimeScope } from "../multitenant/scope/request-context.js";
import type { RuntimeScope } from "../multitenant/scope/runtime-scope.js";
import { routeToolExecution } from "../multitenant/tools/tool-routing.js";
import {
  buildSharedToolUsageEvent,
  reportSharedToolUsageEvent,
} from "../multitenant/usage/usage-reporter.js";
import {
  readScopedTextFile,
  scopedPathExists,
  writeScopedTextFile,
} from "../multitenant/workspace/scoped-fs.js";
import { isTestDefaultMemorySlotDisabled } from "../plugins/config-state.js";
import { getPluginToolMeta } from "../plugins/tools.js";
import { isSubagentSessionKey } from "../routing/session-key.js";
import { DEFAULT_GATEWAY_HTTP_TOOL_DENY } from "../security/dangerous-tools.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import type { ResolvedGatewayAuth } from "./auth.js";
import { authorizeGatewayBearerRequestOrReply } from "./http-auth-helpers.js";
import {
  readJsonBodyOrError,
  sendInvalidRequest,
  sendJson,
  sendMethodNotAllowed,
} from "./http-common.js";
import { getHeader } from "./http-utils.js";

function resolveToolActionFromRequest(
  action: string | undefined,
  args: Record<string, unknown>,
): string | undefined {
  if (action) {
    return action;
  }
  const inlineAction = args.action;
  return typeof inlineAction === "string" && inlineAction.trim() ? inlineAction.trim() : undefined;
}

function sendToolPolicyError(
  res: ServerResponse,
  status: number,
  errorType: string,
  message: string,
  policy: {
    route: "local" | "worker" | "deny";
    allow: boolean;
    reason: string;
    ruleId: string;
    resourceClass: string;
    supportLevel: "stable" | "experimental" | "unsupported";
  },
) {
  sendJson(res, status, {
    ok: false,
    error: {
      type: errorType,
      message,
      policy,
    },
  });
}

const DEFAULT_BODY_BYTES = 2 * 1024 * 1024;
const MEMORY_TOOL_NAMES = new Set(["memory_search", "memory_get"]);

type ToolsInvokeBody = {
  tool?: unknown;
  action?: unknown;
  args?: unknown;
  sessionKey?: unknown;
  dryRun?: unknown;
  runtimeScope?: unknown;
  debugRuntimeScope?: unknown;
  debugScopedFs?: unknown;
};

function resolveSessionKeyFromBody(body: ToolsInvokeBody): string | undefined {
  if (typeof body.sessionKey === "string" && body.sessionKey.trim()) {
    return body.sessionKey.trim();
  }
  return undefined;
}

function tryParseRuntimeScope(value: unknown): RuntimeScope | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<RuntimeScope>;
  if (
    (candidate.mode !== "shared" && candidate.mode !== "dedicated") ||
    typeof candidate.tenantId !== "string" ||
    typeof candidate.userId !== "string" ||
    typeof candidate.logicalInstanceId !== "string" ||
    typeof candidate.sessionId !== "string" ||
    typeof candidate.requestId !== "string"
  ) {
    return undefined;
  }
  return candidate as RuntimeScope;
}

function resolveRuntimeScopeFromRequest(
  req: IncomingMessage,
  body: ToolsInvokeBody,
): RuntimeScope | undefined {
  const bodyScope = tryParseRuntimeScope(body.runtimeScope);
  if (bodyScope) {
    return bodyScope;
  }
  const headerValue = getHeader(req, "x-openclaw-runtime-scope");
  if (!headerValue) {
    return undefined;
  }
  try {
    return tryParseRuntimeScope(JSON.parse(headerValue));
  } catch {
    return undefined;
  }
}

function resolveMemoryToolDisableReasons(cfg: ReturnType<typeof loadConfig>): string[] {
  if (!process.env.VITEST) {
    return [];
  }
  const reasons: string[] = [];
  const plugins = cfg.plugins;
  const slotRaw = plugins?.slots?.memory;
  const slotDisabled =
    slotRaw === null || (typeof slotRaw === "string" && slotRaw.trim().toLowerCase() === "none");
  const pluginsDisabled = plugins?.enabled === false;
  const defaultDisabled = isTestDefaultMemorySlotDisabled(cfg);

  if (pluginsDisabled) {
    reasons.push("plugins.enabled=false");
  }
  if (slotDisabled) {
    reasons.push(slotRaw === null ? "plugins.slots.memory=null" : 'plugins.slots.memory="none"');
  }
  if (!pluginsDisabled && !slotDisabled && defaultDisabled) {
    reasons.push("memory plugin disabled by test default");
  }
  return reasons;
}

function mergeActionIntoArgsIfSupported(params: {
  toolSchema: unknown;
  action: string | undefined;
  args: Record<string, unknown>;
}): Record<string, unknown> {
  const { toolSchema, action, args } = params;
  if (!action) {
    return args;
  }
  if (args.action !== undefined) {
    return args;
  }
  const schemaObj = toolSchema as { properties?: Record<string, unknown> } | null;
  const hasAction = Boolean(
    schemaObj &&
      typeof schemaObj === "object" &&
      schemaObj.properties &&
      "action" in schemaObj.properties,
  );
  if (!hasAction) {
    return args;
  }
  return { ...args, action };
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === "string") {
    return err;
  }
  return String(err);
}

function resolveToolInputErrorStatus(err: unknown): number | null {
  if (err instanceof ToolInputError) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : 400;
  }
  if (typeof err !== "object" || err === null || !("name" in err)) {
    return null;
  }
  const name = (err as { name?: unknown }).name;
  if (name !== "ToolInputError" && name !== "ToolAuthorizationError") {
    return null;
  }
  const status = (err as { status?: unknown }).status;
  if (typeof status === "number") {
    return status;
  }
  return name === "ToolAuthorizationError" ? 403 : 400;
}

function reportToolUsageEvent(params: {
  runtimeScope?: RuntimeScope;
  toolName: string;
  action?: string;
  outcome:
    | "tool_policy_denied"
    | "tool_routed_executed"
    | "tool_route_unavailable"
    | "tool_dedicated_required"
    | "tool_local_executed";
  routeType: "local" | "worker" | "deny";
  startedAtMs: number;
  ruleId?: string;
  reason?: string;
  workerKind?: "browser" | "nodes" | "generic";
}) {
  reportSharedToolUsageEvent(
    buildSharedToolUsageEvent({
      runtimeScope: params.runtimeScope,
      toolName: params.toolName,
      action: params.action,
      outcome: params.outcome,
      routeType: params.routeType,
      ruleId: params.ruleId,
      reason: params.reason,
      latencyMs: Math.max(0, Date.now() - params.startedAtMs),
      workerKind: params.workerKind,
    }),
  );
}

export async function handleToolsInvokeHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    auth: ResolvedGatewayAuth;
    maxBodyBytes?: number;
    trustedProxies?: string[];
    allowRealIpFallback?: boolean;
    rateLimiter?: AuthRateLimiter;
  },
): Promise<boolean> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname !== "/tools/invoke") {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res, "POST");
    return true;
  }

  const cfg = loadConfig();
  const ok = await authorizeGatewayBearerRequestOrReply({
    req,
    res,
    auth: opts.auth,
    trustedProxies: opts.trustedProxies ?? cfg.gateway?.trustedProxies,
    allowRealIpFallback: opts.allowRealIpFallback ?? cfg.gateway?.allowRealIpFallback,
    rateLimiter: opts.rateLimiter,
  });
  if (!ok) {
    return true;
  }

  const bodyUnknown = await readJsonBodyOrError(req, res, opts.maxBodyBytes ?? DEFAULT_BODY_BYTES);
  if (bodyUnknown === undefined) {
    return true;
  }
  const body = (bodyUnknown ?? {}) as ToolsInvokeBody;
  const runtimeScope = resolveRuntimeScopeFromRequest(req, body);
  const debugRuntimeScope = body.debugRuntimeScope === true;
  const debugScopedFs = body.debugScopedFs === true;

  const toolName = typeof body.tool === "string" ? body.tool.trim() : "";
  if (!toolName) {
    sendInvalidRequest(res, "tools.invoke requires body.tool");
    return true;
  }

  if (process.env.VITEST && MEMORY_TOOL_NAMES.has(toolName)) {
    const reasons = resolveMemoryToolDisableReasons(cfg);
    if (reasons.length > 0) {
      const suffix = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
      sendJson(res, 400, {
        ok: false,
        error: {
          type: "invalid_request",
          message:
            `memory tools are disabled in tests${suffix}. ` +
            'Enable by setting plugins.slots.memory="memory-core" (and ensure plugins.enabled is not false).',
        },
      });
      return true;
    }
  }

  const action = typeof body.action === "string" ? body.action.trim() : undefined;
  const argsRaw = body.args;
  const args =
    argsRaw && typeof argsRaw === "object" && !Array.isArray(argsRaw)
      ? (argsRaw as Record<string, unknown>)
      : {};

  const rawSessionKey = resolveSessionKeyFromBody(body);
  const sessionKey =
    !rawSessionKey || rawSessionKey === "main" ? resolveMainSessionKey(cfg) : rawSessionKey;

  if (debugRuntimeScope || debugScopedFs) {
    const safeResolve = <T>(label: string, fn: () => T) => {
      try {
        return { ok: true as const, value: fn() };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
          label,
        };
      }
    };

    const safeResolveAsync = async <T>(label: string, fn: () => Promise<T>) => {
      try {
        return { ok: true as const, value: await fn() };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
          label,
        };
      }
    };

    const scopedWorkspaceWriteRead = runtimeScope
      ? await safeResolveAsync("scopedWorkspaceWriteRead", async () => {
          const content = `hello-from-${runtimeScope.logicalInstanceId}`;
          const writtenPath = await writeScopedTextFile(
            runtimeScope,
            "debug/hello.txt",
            content,
            "workspace",
          );
          const readBack = await readScopedTextFile(runtimeScope, "debug/hello.txt", "workspace");
          return {
            writtenPath,
            readBack,
            matches: readBack === content,
          };
        })
      : { ok: false as const, label: "scopedWorkspaceWriteRead", error: "runtimeScope missing" };

    sendJson(res, 200, {
      ok: true,
      debug: {
        runtimeScopePresent: Boolean(runtimeScope),
        runtimeScope: runtimeScope ?? null,
        resolvedWorkspaceRoot: safeResolve("resolvedWorkspaceRoot", () =>
          resolveWorkspaceRootForScope(runtimeScope),
        ),
        resolvedMemoryStorePath: safeResolve("resolvedMemoryStorePath", () =>
          resolveMemoryStorePathForScope(runtimeScope),
        ),
        scopedSessionStoreKey: safeResolve("scopedSessionStoreKey", () =>
          resolveStoreKeyForScope(runtimeScope, sessionKey),
        ),
        scopedSafeWorkspacePath: safeResolve("scopedSafeWorkspacePath", () =>
          resolveSafeUserPathForScope(runtimeScope, "debug/hello.txt", "workspace"),
        ),
        scopedSafeDataPath: safeResolve("scopedSafeDataPath", () =>
          resolveSafeUserPathForScope(runtimeScope, "debug/hello.txt", "data"),
        ),
        scopedWorkspaceFileExists: runtimeScope
          ? await safeResolveAsync("scopedWorkspaceFileExists", () =>
              scopedPathExists(runtimeScope, "debug/hello.txt", "workspace"),
            )
          : { ok: false as const, label: "scopedWorkspaceFileExists", error: "runtimeScope missing" },
        scopedWorkspaceWriteRead,
      },
    });
    return true;
  }

  const messageChannel = normalizeMessageChannel(
    getHeader(req, "x-openclaw-message-channel") ?? "",
  );
  const accountId = getHeader(req, "x-openclaw-account-id")?.trim() || undefined;
  const agentTo = getHeader(req, "x-openclaw-message-to")?.trim() || undefined;
  const agentThreadId = getHeader(req, "x-openclaw-thread-id")?.trim() || undefined;

  const {
    agentId,
    globalPolicy,
    globalProviderPolicy,
    agentPolicy,
    agentProviderPolicy,
    profile,
    providerProfile,
    profileAlsoAllow,
    providerProfileAlsoAllow,
  } = resolveEffectiveToolPolicy({ config: cfg, sessionKey });
  const profilePolicy = resolveToolProfilePolicy(profile);
  const providerProfilePolicy = resolveToolProfilePolicy(providerProfile);

  const profilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(profilePolicy, profileAlsoAllow);
  const providerProfilePolicyWithAlsoAllow = mergeAlsoAllowPolicy(
    providerProfilePolicy,
    providerProfileAlsoAllow,
  );
  const groupPolicy = resolveGroupToolPolicy({
    config: cfg,
    sessionKey,
    messageProvider: messageChannel ?? undefined,
    accountId: accountId ?? null,
  });
  const subagentPolicy = isSubagentSessionKey(sessionKey)
    ? resolveSubagentToolPolicy(cfg)
    : undefined;

  const allTools = runWithOptionalRuntimeScope(runtimeScope, () =>
    createOpenClawTools({
      agentSessionKey: sessionKey,
      agentChannel: messageChannel ?? undefined,
      agentAccountId: accountId,
      agentTo,
      agentThreadId,
      allowGatewaySubagentBinding: true,
      allowMediaInvokeCommands: true,
      runtimeScope,
      config: cfg,
      pluginToolAllowlist: collectExplicitAllowlist([
        profilePolicy,
        providerProfilePolicy,
        globalPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        groupPolicy,
        subagentPolicy,
      ]),
    }),
  );

  const subagentFiltered = applyToolPolicyPipeline({
    // oxlint-disable-next-line typescript/no-explicit-any
    tools: allTools as any,
    // oxlint-disable-next-line typescript/no-explicit-any
    toolMeta: (tool) => getPluginToolMeta(tool as any),
    warn: logWarn,
    steps: [
      ...buildDefaultToolPolicyPipelineSteps({
        profilePolicy: profilePolicyWithAlsoAllow,
        profile,
        providerProfilePolicy: providerProfilePolicyWithAlsoAllow,
        providerProfile,
        globalPolicy,
        globalProviderPolicy,
        agentPolicy,
        agentProviderPolicy,
        groupPolicy,
        agentId,
      }),
      { policy: subagentPolicy, label: "subagent tools.allow" },
    ],
  });

  const gatewayToolsCfg = cfg.gateway?.tools;
  const defaultGatewayDeny: string[] = DEFAULT_GATEWAY_HTTP_TOOL_DENY.filter(
    (name) => !gatewayToolsCfg?.allow?.includes(name),
  );
  const gatewayDenyNames = defaultGatewayDeny.concat(
    Array.isArray(gatewayToolsCfg?.deny) ? gatewayToolsCfg.deny : [],
  );
  const gatewayDenySet = new Set(gatewayDenyNames);
  const gatewayFiltered = subagentFiltered.filter((t) => !gatewayDenySet.has(t.name));

  const tool = gatewayFiltered.find((t) => t.name === toolName);
  if (!tool) {
    sendJson(res, 404, {
      ok: false,
      error: { type: "not_found", message: `Tool not available: ${toolName}` },
    });
    return true;
  }

  try {
    const startedAtMs = Date.now();
    const toolCallId = `http-${Date.now()}`;
    const resolvedAction = resolveToolActionFromRequest(action, args);
    const toolArgs = mergeActionIntoArgsIfSupported({
      // oxlint-disable-next-line typescript/no-explicit-any
      toolSchema: (tool as any).parameters,
      action: resolvedAction,
      args,
    });
    const hookResult = await runWithOptionalRuntimeScope(runtimeScope, () =>
      runBeforeToolCallHook({
        toolName,
        params: toolArgs,
        toolCallId,
        ctx: {
          agentId,
          sessionKey,
          loopDetection: resolveToolLoopDetectionConfig({ cfg, agentId }),
        },
      }),
    );
    if (hookResult.blocked) {
      sendJson(res, 403, {
        ok: false,
        error: { type: "tool_call_blocked", message: hookResult.reason },
      });
      return true;
    }

    const policyDecision = await resolveToolExecutionPolicy({
      runtimeScope,
      toolName,
      args: hookResult.params,
    });

    if (policyDecision.route === "deny") {
      reportToolUsageEvent({
        runtimeScope,
        toolName,
        action: resolvedAction,
        outcome: "tool_policy_denied",
        routeType: "deny",
        startedAtMs,
        ruleId: policyDecision.ruleId,
        reason: policyDecision.reason,
      });
      sendToolPolicyError(
        res,
        403,
        "tool_policy_denied",
        policyDecision.reason,
        policyDecision,
      );
      return true;
    }

    if (policyDecision.route === "worker") {
      const routingResult = await routeToolExecution({
        runtimeScope,
        toolName,
        toolArgs: hookResult.params,
        toolCallId,
        policyDecision,
        // oxlint-disable-next-line typescript/no-explicit-any
        tool: tool as any,
      });

      if (routingResult.executed) {
        reportToolUsageEvent({
          runtimeScope,
          toolName,
          action: resolvedAction,
          outcome: "tool_routed_executed",
          routeType: "worker",
          startedAtMs,
          ruleId: policyDecision.ruleId,
          workerKind: routingResult.workerKind,
        });
        sendJson(res, 200, { ok: true, result: routingResult.result });
        return true;
      }

      reportToolUsageEvent({
        runtimeScope,
        toolName,
        action: resolvedAction,
        outcome: routingResult.errorType,
        routeType: "worker",
        startedAtMs,
        ruleId: routingResult.ruleId ?? policyDecision.ruleId,
        reason: routingResult.reason,
        workerKind: routingResult.workerKind,
      });
      const status = routingResult.mode === "dedicated-required" ? 409 : 501;
      sendToolPolicyError(res, status, routingResult.errorType, routingResult.reason, policyDecision);
      return true;
    }

    // oxlint-disable-next-line typescript/no-explicit-any
    const result = await runWithOptionalRuntimeScope(runtimeScope, () =>
      (tool as any).execute?.(toolCallId, hookResult.params),
    );
    reportToolUsageEvent({
      runtimeScope,
      toolName,
      action: resolvedAction,
      outcome: "tool_local_executed",
      routeType: "local",
      startedAtMs,
      ruleId: policyDecision.ruleId,
    });
    sendJson(res, 200, { ok: true, result });
  } catch (err) {
    const inputStatus = resolveToolInputErrorStatus(err);
    if (inputStatus !== null) {
      sendJson(res, inputStatus, {
        ok: false,
        error: { type: "tool_error", message: getErrorMessage(err) || "invalid tool arguments" },
      });
      return true;
    }
    logWarn(`tools-invoke: tool execution failed: ${String(err)}`);
    sendJson(res, 500, {
      ok: false,
      error: { type: "tool_error", message: "tool execution failed" },
    });
  }

  return true;
}
