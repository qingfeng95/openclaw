import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withEnvAsync } from "../test-utils/env.js";
import { AUTH_NONE, sendRequest, withGatewayServer } from "./server-http.test-harness.js";

describe("shared instance HTTP routes", () => {
  it("stay reachable when root-mounted control ui is enabled", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-shared-routes-"));
    try {
      await withEnvAsync(
        {
          OPENCLAW_VERSION: "2026.3.30-route-test",
          OPENCLAW_STATE_DIR: tempDir,
        },
        async () => {
          await withGatewayServer({
            prefix: "shared-instance-routes-",
            resolvedAuth: AUTH_NONE,
            overrides: {
              controlUiEnabled: true,
              controlUiBasePath: "",
              controlUiRoot: { kind: "missing" },
            },
            run: async (server) => {
              const versionResponse = await sendRequest(server, { path: "/version" });
              expect(versionResponse.res.statusCode).toBe(200);
              expect(JSON.parse(versionResponse.getBody())).toEqual({
                ok: true,
                version: "2026.3.30-route-test",
              });

              const usageResponse = await sendRequest(server, {
                path: "/shared/usage/summary",
              });
              expect(usageResponse.res.statusCode).toBe(200);
              expect(JSON.parse(usageResponse.getBody())).toEqual({
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
            },
          });
        },
      );
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
