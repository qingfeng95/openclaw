import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readSharedToolUsageEvents, summarizeSharedToolUsageEvents } from "../multitenant/usage/usage-summary.js";
import { resolveSharedToolUsageLogPath } from "../multitenant/usage/usage-reporter.js";
import { resolveRuntimeServiceVersion } from "../version.js";
import { sendJson, sendMethodNotAllowed } from "./http-common.js";

export const SHARED_INSTANCE_VERSION_PATH = "/version";
export const SHARED_INSTANCE_USAGE_SUMMARY_PATH = "/shared/usage/summary";

function createEmptyUsageSummary(filePath: string) {
  return {
    totalCount: 0,
    countsByOutcome: {},
    countsByToolName: {},
    countsByToolNameAction: {},
    countsByRouteType: {},
    countsByRuleId: {},
    countsByDeniedReason: {},
    filePath,
    note: "No shared tool usage log found.",
  };
}

function sendHeadOrJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): true {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  if ((req.method ?? "GET").toUpperCase() === "HEAD") {
    res.end();
    return true;
  }
  res.end(JSON.stringify(body));
  return true;
}

export function handleSharedInstanceHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    env?: NodeJS.ProcessEnv;
    usageLogPath?: string;
  } = {},
): true | false {
  const hostHeader = Array.isArray(req.headers?.host) ? req.headers.host[0] : req.headers?.host;
  const url = new URL(req.url ?? "/", `http://${hostHeader ?? "localhost"}`);
  const method = (req.method ?? "GET").toUpperCase();
  const env = opts.env ?? process.env;

  if (url.pathname === SHARED_INSTANCE_VERSION_PATH) {
    if (method !== "GET" && method !== "HEAD") {
      sendMethodNotAllowed(res, "GET, HEAD");
      return true;
    }
    return sendHeadOrJson(req, res, 200, {
      ok: true,
      version: resolveRuntimeServiceVersion(env),
    });
  }

  if (url.pathname !== SHARED_INSTANCE_USAGE_SUMMARY_PATH) {
    return false;
  }

  if (method !== "GET" && method !== "HEAD") {
    sendMethodNotAllowed(res, "GET, HEAD");
    return true;
  }

  const filePath = opts.usageLogPath ?? resolveSharedToolUsageLogPath(env);
  if (!fs.existsSync(filePath)) {
    return sendHeadOrJson(req, res, 200, {
      ok: true,
      ...createEmptyUsageSummary(filePath),
    });
  }

  try {
    const events = readSharedToolUsageEvents(filePath, { ignoreInvalidLines: true });
    return sendHeadOrJson(req, res, 200, {
      ok: true,
      ...summarizeSharedToolUsageEvents(events),
      filePath,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: {
        type: "internal_error",
        message:
          error instanceof Error ? error.message : "Failed to read shared tool usage summary.",
      },
    });
    return true;
  }
}
