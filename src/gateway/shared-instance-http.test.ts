import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { withEnvAsync } from "../test-utils/env.js";
import { makeMockHttpResponse } from "./test-http-response.js";
import {
  handleSharedInstanceHttpRequest,
  SHARED_INSTANCE_USAGE_SUMMARY_PATH,
  SHARED_INSTANCE_VERSION_PATH,
} from "./shared-instance-http.js";

describe("handleSharedInstanceHttpRequest", () => {
  afterEach(() => {
    delete process.env.OPENCLAW_VERSION;
  });

  it("serves runtime version JSON", () => {
    const { res, end } = makeMockHttpResponse();

    const handled = handleSharedInstanceHttpRequest(
      { url: SHARED_INSTANCE_VERSION_PATH, method: "GET" } as IncomingMessage,
      res,
      { env: { OPENCLAW_VERSION: "2026.3.30-test" } as NodeJS.ProcessEnv },
    );

    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
      ok: true,
      version: "2026.3.30-test",
    });
  });

  it("returns empty summary payload when the usage log is missing", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-shared-http-"));
    try {
      const { res, end } = makeMockHttpResponse();
      const handled = await withEnvAsync(
        { OPENCLAW_STATE_DIR: tempDir },
        async () =>
          handleSharedInstanceHttpRequest(
            { url: SHARED_INSTANCE_USAGE_SUMMARY_PATH, method: "GET" } as IncomingMessage,
            res,
          ),
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
        ok: true,
        totalCount: 0,
        countsByOutcome: {},
        countsByToolName: {},
        countsByToolNameAction: {},
        countsByRouteType: {},
        countsByRuleId: {},
        countsByDeniedReason: {},
        filePath: path.join(tempDir, "logs", "shared-tool-usage.jsonl"),
        note: "No shared tool usage log found.",
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });

  it("summarizes shared usage events from the state log", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-shared-http-"));
    try {
      const logDir = path.join(tempDir, "logs");
      await fs.mkdir(logDir, { recursive: true });
      await fs.writeFile(
        path.join(logDir, "shared-tool-usage.jsonl"),
        [
          JSON.stringify({
            ts: "2026-03-30T10:00:00.000Z",
            timestamp: "2026-03-30T10:00:00.000Z",
            instanceId: "shared-a",
            toolName: "browser",
            action: "status",
            outcome: "allowed",
            routeType: "shared_worker",
          }),
          JSON.stringify({
            ts: "2026-03-30T10:01:00.000Z",
            timestamp: "2026-03-30T10:01:00.000Z",
            instanceId: "shared-a",
            toolName: "web_fetch",
            action: "fetch",
            outcome: "tool_policy_denied",
            routeType: "fallback_refused",
            deniedReason: "remote-disabled",
            ruleId: "shared.web_fetch",
          }),
        ].join("\n"),
        "utf8",
      );

      const { res, end } = makeMockHttpResponse();
      const handled = await withEnvAsync(
        { OPENCLAW_STATE_DIR: tempDir },
        async () =>
          handleSharedInstanceHttpRequest(
            { url: SHARED_INSTANCE_USAGE_SUMMARY_PATH, method: "GET" } as IncomingMessage,
            res,
          ),
      );

      expect(handled).toBe(true);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(String(end.mock.calls[0]?.[0] ?? ""))).toEqual({
        ok: true,
        totalCount: 2,
        countsByOutcome: {
          allowed: 1,
          tool_policy_denied: 1,
        },
        countsByToolName: {
          browser: 1,
          web_fetch: 1,
        },
        countsByToolNameAction: {
          "browser:status": 1,
          "web_fetch:fetch": 1,
        },
        countsByRouteType: {
          shared_worker: 1,
          fallback_refused: 1,
        },
        countsByRuleId: {
          "shared.web_fetch": 1,
        },
        countsByDeniedReason: {
          "remote-disabled": 1,
        },
        filePath: path.join(tempDir, "logs", "shared-tool-usage.jsonl"),
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
