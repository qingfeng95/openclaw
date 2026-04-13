import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer as createHttpServer } from "node:http";
import { describe, expect, it } from "vitest";
import { WebSocket as TestWebSocket, WebSocketServer as TestWebSocketServer } from "ws";
import {
  createSharedConsoleApiServer,
  type OpsCommandInvocation,
  type OpsCommandResult,
} from "../apps/shared-console-api/src/server.js";

async function withTempInstancesRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-shared-console-api-"));
  try {
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function writeInstance(
  root: string,
  params: {
    id: string;
    name?: string;
    modelChannelId?: string;
    port?: number;
    profile?: string;
    bind?: string;
    template?: string;
    runtimeKind?: "host" | "container";
    containerName?: string;
    containerId?: string;
    proxyToken?: string;
  },
): Promise<void> {
  const instanceDir = path.join(root, params.id);
  const logDir = path.join(instanceDir, "logs");
  const runDir = path.join(instanceDir, "run");
  const stateDir = path.join(instanceDir, "state");
  const configDir = path.join(instanceDir, "config");
  await fs.mkdir(logDir, { recursive: true });
  await fs.mkdir(runDir, { recursive: true });
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(instanceDir, "instance.env"),
    [
      `INSTANCE_ID="${params.id}"`,
      `INSTANCE_NAME="${params.name ?? params.id}"`,
      ...(params.modelChannelId ? [`INSTANCE_MODEL_CHANNEL_ID="${params.modelChannelId}"`] : []),
      `INSTANCE_DIR="${instanceDir}"`,
      `INSTANCE_ROOT="${root}"`,
      `INSTANCE_RUNTIME_KIND="${params.runtimeKind ?? "host"}"`,
      `INSTANCE_PORT="${params.port ?? 19100}"`,
      `INSTANCE_PROFILE="${params.profile ?? `shared-${params.id}`}"`,
      `INSTANCE_BIND="${params.bind ?? "loopback"}"`,
      `INSTANCE_TEMPLATE="${params.template ?? "internal-test"}"`,
      ...(params.proxyToken ? [`INSTANCE_PROXY_TOKEN="${params.proxyToken}"`] : []),
      ...(params.containerName ? [`INSTANCE_CONTAINER_NAME="${params.containerName}"`] : []),
      ...(params.containerId ? [`INSTANCE_CONTAINER_ID="${params.containerId}"`] : []),
      `INSTANCE_LOG_DIR="${logDir}"`,
      `INSTANCE_RUN_DIR="${runDir}"`,
      `INSTANCE_STATE_DIR="${stateDir}"`,
      `INSTANCE_CONFIG_PATH="${path.join(configDir, "openclaw.instance.json5")}"`,
      `INSTANCE_PID_FILE="${path.join(runDir, "gateway.pid")}"`,
      `OPENCLAW_STATE_DIR="${stateDir}"`,
      `OPENCLAW_CONFIG_PATH="${path.join(configDir, "openclaw.instance.json5")}"`,
      "",
    ].join("\n"),
    "utf8",
  );
}

async function startTestServer(params: {
  root: string;
  repoRoot?: string;
  modelChannelsPath?: string;
  runOpsCommand?: (invocation: OpsCommandInvocation) => Promise<OpsCommandResult>;
  runDockerCommand?: (invocation: { args: string[] }) => Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
  }>;
  listDockerContainers?: () => Promise<
    Array<{
      id: string;
      name: string;
      image: string | null;
      state: string | null;
      status: string | null;
      createdAt: string | null;
      ports: string[];
      labels: Record<string, string>;
    }>
  >;
  adminToken?: string;
}) {
  const server = createSharedConsoleApiServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      repoRoot: params.repoRoot ?? params.root,
      sharedInstancesRoot: params.root,
      dedicatedInstancesRoot: path.join(params.root, ".dedicated"),
      ...(params.modelChannelsPath ? { modelChannelsPath: params.modelChannelsPath } : {}),
      adminToken: params.adminToken ?? null,
    },
    runOpsCommand: params.runOpsCommand,
    listDockerContainers: params.listDockerContainers,
    runDockerCommand: params.runDockerCommand,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve test server address.");
  }

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopServer(server: { close: (cb: (error?: Error) => void) => void }): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function startHttpEchoServer(
  handler: (req: Parameters<Parameters<typeof createHttpServer>[0]>[0], res: Parameters<Parameters<typeof createHttpServer>[0]>[1]) => void,
) {
  const server = createHttpServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve echo server address.");
  }
  return {
    server,
    port: address.port,
  };
}

async function waitForWebSocketMessage(socket: TestWebSocket): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const handleMessage = (data: Buffer | string) => {
      cleanup();
      resolve(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleClose = () => {
      cleanup();
      reject(new Error("websocket closed before a message was received"));
    };
    const cleanup = () => {
      socket.off("message", handleMessage);
      socket.off("error", handleError);
      socket.off("close", handleClose);
    };
    socket.on("message", handleMessage);
    socket.on("error", handleError);
    socket.on("close", handleClose);
  });
}

describe("shared console api", () => {
  it("lists instances from the instances root", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "alpha",
        name: "Alpha",
        port: 19111,
      });

      const { server, baseUrl } = await startTestServer({ root });
      try {
        const response = await fetch(`${baseUrl}/api/instances`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          items: [
            {
              id: "alpha",
              name: "Alpha",
              modelChannelId: null,
              bind: "loopback",
              port: 19111,
              profile: "shared-alpha",
              template: "internal-test",
              runtime: {
                location: "host",
                containerName: null,
                containerId: null,
              },
              paths: {
                root,
                dir: path.join(root, "alpha"),
                configPath: path.join(root, "alpha", "config", "openclaw.instance.json5"),
                stateDir: path.join(root, "alpha", "state"),
                logDir: path.join(root, "alpha", "logs"),
                runDir: path.join(root, "alpha", "run"),
                pidFile: path.join(root, "alpha", "run", "gateway.pid"),
              },
              process: {
                state: "stopped",
                pid: null,
              },
              timestamps: {
                createdAt: expect.any(String),
                updatedAt: expect.any(String),
              },
              probe: null,
            },
          ],
          meta: {
            pool: "shared",
            instancesRoot: root,
            includeProbe: false,
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("lists public channel catalog and exposes full settings only to admin requests", async () => {
    await withTempInstancesRoot(async (root) => {
      const modelChannelsPath = path.join(root, "model-channels.json");
      await fs.writeFile(
        modelChannelsPath,
        JSON.stringify(
          {
            userCanConfigureModels: false,
            channels: [
              {
                id: "openai-main",
                name: "OpenAI Main",
                providerId: "openai-main",
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-secret",
                api: "openai-responses",
                models: [
                  {
                    id: "gpt-5-mini",
                    name: "GPT-5 mini",
                    reasoning: true,
                    input: ["text"],
                    contextWindow: 128000,
                    maxTokens: 16000,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
                defaultModel: "openai-main/gpt-5-mini",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const { server, baseUrl } = await startTestServer({
        root,
        modelChannelsPath,
        adminToken: "console-admin-secret",
      });

      try {
        const publicResponse = await fetch(`${baseUrl}/api/model-channels`);
        expect(publicResponse.status).toBe(200);
        expect(await publicResponse.json()).toEqual({
          ok: true,
          admin: false,
            catalog: {
              userCanConfigureModels: false,
              channels: [
                {
                  id: "openai-main",
                  name: "OpenAI Main",
                  kind: "channel",
                  providerId: "openai-main",
                  defaultModel: "openai-main/gpt-5-mini",
                },
              ],
            },
        });

        const adminResponse = await fetch(`${baseUrl}/api/model-channels`, {
          headers: {
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
        });
        expect(adminResponse.status).toBe(200);
        const adminPayload = await adminResponse.json();
        expect(adminPayload.ok).toBe(true);
        expect(adminPayload.admin).toBe(true);
        expect(adminPayload.catalog.channels).toHaveLength(1);
        expect(adminPayload.settings.channels[0].apiKey).toBe("sk-secret");
      } finally {
        await stopServer(server);
      }
    });
  });

  it("returns core instance detail without probe by default and serves diagnostics separately", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "alpha",
        name: "Alpha",
        port: 19111,
        runtimeKind: "container",
        containerName: "crewclaw-alpha",
        containerId: "cid-alpha",
      });
      await fs.writeFile(path.join(root, "alpha", "run", "gateway.pid"), "4242\n", "utf8");

      const { server, baseUrl } = await startTestServer({
        root,
        runDockerCommand: async (invocation) => {
          const url = invocation.args.at(-2) ?? "";
          if (url.endsWith("/healthz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
          }
          if (url.endsWith("/readyz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ready: true }), stderr: "" };
          }
          if (url.endsWith("/version")) {
            return { exitCode: 0, stdout: JSON.stringify({ version: "2026.4.4" }), stderr: "" };
          }
          if (url.endsWith("/shared/usage/summary")) {
            return { exitCode: 0, stdout: JSON.stringify({ totalCount: 3 }), stderr: "" };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected url: ${url}` };
        },
      });

      try {
        const detailResponse = await fetch(`${baseUrl}/api/instances/alpha`);
        expect(detailResponse.status).toBe(200);
        const detailPayload = await detailResponse.json();
        expect(detailPayload.ok).toBe(true);
        expect(detailPayload.item.id).toBe("alpha");
        expect(detailPayload.item.probe).toBeNull();

        const diagnosticsResponse = await fetch(`${baseUrl}/api/instances/alpha/diagnostics`);
        expect(diagnosticsResponse.status).toBe(200);
        const diagnosticsPayload = await diagnosticsResponse.json();
        expect(diagnosticsPayload).toMatchObject({
          ok: true,
          item: {
            id: "alpha",
            pool: "shared",
            probe: {
              live: true,
              ready: true,
              version: "2026.4.4",
              usageSummary: {
                totalCount: 3,
              },
            },
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("serves usage summary through a dedicated route", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "alpha",
        name: "Alpha",
        port: 19111,
        runtimeKind: "container",
        containerName: "crewclaw-alpha",
        containerId: "cid-alpha",
      });
      await fs.writeFile(path.join(root, "alpha", "run", "gateway.pid"), "4242\n", "utf8");

      const { server, baseUrl } = await startTestServer({
        root,
        runDockerCommand: async (invocation) => {
          const url = invocation.args.at(-2) ?? "";
          if (url.endsWith("/shared/usage/summary")) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ totalCount: 9, countsByOutcome: { tool_routed_executed: 9 } }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected url: ${url}` };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/instances/alpha/usage-summary`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true,
          item: {
            id: "alpha",
            pool: "shared",
            usageSummary: {
              totalCount: 9,
              countsByOutcome: {
                tool_routed_executed: 9,
              },
            },
            checkedAt: expect.any(String),
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });


  it("aggregates collection usage summaries without colliding with item routes", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "usage-summary",
        name: "Aggregate Shadow",
        port: 19110,
        runtimeKind: "container",
        containerName: "crewclaw-shadow",
        containerId: "cid-shadow",
      });
      await writeInstance(root, {
        id: "alpha",
        name: "Alpha",
        port: 19111,
        runtimeKind: "container",
        containerName: "crewclaw-alpha",
        containerId: "cid-alpha",
      });
      await writeInstance(root, {
        id: "stopped",
        name: "Stopped",
        port: 19112,
      });
      await fs.writeFile(path.join(root, "usage-summary", "run", "gateway.pid"), "4242\n", "utf8");
      await fs.writeFile(path.join(root, "alpha", "run", "gateway.pid"), "4343\n", "utf8");

      const { server, baseUrl } = await startTestServer({
        root,
        runDockerCommand: async (invocation) => {
          const selector = invocation.args[1] ?? "";
          const url = invocation.args.at(-2) ?? "";
          if (!url.endsWith("/shared/usage/summary")) {
            return { exitCode: 1, stdout: "", stderr: `unexpected url: ${url}` };
          }
          if (selector === "crewclaw-shadow") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                totalCount: 4,
                countsByOutcome: { tool_denied: 1, tool_local_executed: 3 },
                countsByToolName: { browser: 4 },
                countsByToolNameAction: { "browser.open": 4 },
                countsByRouteType: { local: 3, worker: 1 },
                countsByRuleId: { "shared.browser.worker.v1": 1 },
                countsByDeniedReason: { policy: 1 },
              }),
              stderr: "",
            };
          }
          if (selector === "crewclaw-alpha") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                totalCount: 6,
                countsByOutcome: { tool_routed_executed: 6 },
                countsByToolName: { nodes: 6 },
                countsByToolNameAction: { "nodes.run": 6 },
                countsByRouteType: { worker: 6 },
                countsByRuleId: { "default.local.v1": 6 },
                countsByDeniedReason: {},
              }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected selector: ${selector}` };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/instances/usage-summary`);
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          ok: true,
          item: {
            pool: "shared",
            usageSummary: {
              totalCount: 10,
              countsByOutcome: {
                tool_denied: 1,
                tool_local_executed: 3,
                tool_routed_executed: 6,
              },
              countsByToolName: {
                browser: 4,
                nodes: 6,
              },
              countsByToolNameAction: {
                "browser.open": 4,
                "nodes.run": 6,
              },
              countsByRouteType: {
                local: 3,
                worker: 7,
              },
              countsByRuleId: {
                "shared.browser.worker.v1": 1,
                "default.local.v1": 6,
              },
              countsByDeniedReason: {
                policy: 1,
              },
            },
            instanceCount: 3,
            reportedInstanceCount: 2,
            checkedAt: expect.any(String),
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("keeps diagnostics and usage-summary caches isolated", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "theta",
        name: "Theta",
        port: 19118,
        runtimeKind: "container",
        containerName: "crewclaw-theta",
        containerId: "cid-theta",
      });
      await fs.writeFile(path.join(root, "theta", "run", "gateway.pid"), "5151\n", "utf8");

      const dockerInvocations: string[][] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runDockerCommand: async (invocation) => {
          dockerInvocations.push(invocation.args);
          const url = invocation.args.at(-2) ?? "";
          if (url.endsWith("/healthz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
          }
          if (url.endsWith("/readyz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ready: true }), stderr: "" };
          }
          if (url.endsWith("/version")) {
            return { exitCode: 0, stdout: JSON.stringify({ version: "2026.3.24" }), stderr: "" };
          }
          if (url.endsWith("/shared/usage/summary")) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ totalCount: 7, countsByOutcome: { tool_routed_executed: 7 } }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected url: ${url}` };
        },
      });

      try {
        const diagnosticsResponse = await fetch(`${baseUrl}/api/instances/theta/diagnostics`);
        expect(diagnosticsResponse.status).toBe(200);
        const usageResponse = await fetch(`${baseUrl}/api/instances/theta/usage-summary`);
        expect(usageResponse.status).toBe(200);
        const secondDiagnosticsResponse = await fetch(`${baseUrl}/api/instances/theta/diagnostics`);
        expect(secondDiagnosticsResponse.status).toBe(200);
        const secondUsageResponse = await fetch(`${baseUrl}/api/instances/theta/usage-summary`);
        expect(secondUsageResponse.status).toBe(200);

        const diagnosticsPayload = await diagnosticsResponse.json();
        const usagePayload = await usageResponse.json();
        expect(diagnosticsPayload.item.probe).toMatchObject({
          live: true,
          ready: true,
          version: "2026.3.24",
          usageSummary: {
            totalCount: 7,
          },
        });
        expect(usagePayload.item).toMatchObject({
          usageSummary: {
            totalCount: 7,
          },
        });

        expect(dockerInvocations.filter((args) => (args.at(-2) ?? "").endsWith("/healthz"))).toHaveLength(1);
        expect(dockerInvocations.filter((args) => (args.at(-2) ?? "").endsWith("/readyz"))).toHaveLength(1);
        expect(dockerInvocations.filter((args) => (args.at(-2) ?? "").endsWith("/version"))).toHaveLength(1);
        expect(dockerInvocations.filter((args) => (args.at(-2) ?? "").endsWith("/shared/usage/summary"))).toHaveLength(1);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("creates instances with an assigned model channel and writes model config", async () => {
    await withTempInstancesRoot(async (root) => {
      const modelChannelsPath = path.join(root, "model-channels.json");
      await fs.writeFile(
        modelChannelsPath,
        JSON.stringify(
          {
            userCanConfigureModels: false,
            channels: [
              {
                id: "openai-main",
                name: "OpenAI Main",
                providerId: "openai-main",
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-secret",
                api: "openai-responses",
                models: [
                  {
                    id: "gpt-5-mini",
                    name: "GPT-5 mini",
                    reasoning: true,
                    input: ["text"],
                    contextWindow: 128000,
                    maxTokens: 16000,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
                defaultModel: "openai-main/gpt-5-mini",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        modelChannelsPath,
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          if (invocation.scriptName === "create-instance.sh") {
            await writeInstance(root, {
              id: "modelled",
              name: "Modelled",
              port: 19119,
            });
          }
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
          };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/instances`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "modelled",
            name: "Modelled",
            modelChannelId: "openai-main",
          }),
        });

        expect(response.status).toBe(201);
        const payload = await response.json();
        expect(payload.item.modelChannelId).toBe("openai-main");
        expect(invocations[0]?.scriptName).toBe("create-instance.sh");

        const envFile = await fs.readFile(path.join(root, "modelled", "instance.env"), "utf8");
        expect(envFile).toContain('INSTANCE_MODEL_CHANNEL_ID="openai-main"');

        const configFile = JSON.parse(
          await fs.readFile(path.join(root, "modelled", "config", "openclaw.instance.json5"), "utf8"),
        );
        expect(configFile.models.providers["openai-main"]).toMatchObject({
          baseUrl: "https://api.openai.com/v1",
          apiKey: "sk-secret",
          api: "openai-responses",
        });
        expect(configFile.agents.defaults).toMatchObject({
          model: "openai-main/gpt-5-mini",
          models: {
            "openai-main/gpt-5-mini": {},
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("generates model channel draft settings from simple admin inputs", async () => {
    await withTempInstancesRoot(async (root) => {
      const { server, baseUrl } = await startTestServer({
        root,
        adminToken: "console-admin-secret",
      });

      try {
        const response = await fetch(`${baseUrl}/api/model-channels/generate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
          body: JSON.stringify({
            settings: {
              userCanConfigureModels: false,
              channels: [],
              channelGroups: [],
            },
            generator: {
              baseUrl: "https://ice.v.ua/v1",
              apiKeys: ["sk-a", "sk-b"],
              modelIds: ["gpt-5.4"],
              channelIdPrefix: "ice-vua",
              channelNamePrefix: "ICE VUA",
              reasoning: true,
              createRoundRobinGroup: true,
            },
          }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.meta).toEqual({
          generatedChannelIds: ["ice-vua-1", "ice-vua-2"],
          generatedGroupId: "ice-vua-rr",
        });
        expect(payload.settings.channels).toMatchObject([
          {
            id: "ice-vua-1",
            name: "ICE VUA 1",
            providerId: "ice-vua-1",
            baseUrl: "https://ice.v.ua/v1",
            apiKey: "sk-a",
            api: "openai-responses",
            defaultModel: "ice-vua-1/gpt-5.4",
          },
          {
            id: "ice-vua-2",
            name: "ICE VUA 2",
            providerId: "ice-vua-2",
            baseUrl: "https://ice.v.ua/v1",
            apiKey: "sk-b",
            api: "openai-responses",
            defaultModel: "ice-vua-2/gpt-5.4",
          },
        ]);
        expect(payload.settings.channelGroups).toEqual([
          {
            id: "ice-vua-rr",
            name: "ICE VUA RR",
            strategy: "round-robin",
            channelIds: ["ice-vua-1", "ice-vua-2"],
          },
        ]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("auto-unassigns instances when removed channels are saved with auto-unassign enabled", async () => {
    await withTempInstancesRoot(async (root) => {
      const modelChannelsPath = path.join(root, "model-channels.json");
      await fs.writeFile(
        modelChannelsPath,
        JSON.stringify(
          {
            userCanConfigureModels: false,
            channels: [
              {
                id: "openai-main",
                name: "OpenAI Main",
                providerId: "openai-main",
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-secret",
                api: "openai-responses",
                models: [
                  {
                    id: "gpt-5-mini",
                    name: "GPT-5 mini",
                    reasoning: true,
                    input: ["text"],
                    contextWindow: 128000,
                    maxTokens: 16000,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
                defaultModel: "openai-main/gpt-5-mini",
              },
            ],
            channelGroups: [],
          },
          null,
          2,
        ),
        "utf8",
      );
      await writeInstance(root, {
        id: "alpha",
        name: "Alpha",
        modelChannelId: "openai-main",
        port: 19111,
      });

      const { server, baseUrl } = await startTestServer({
        root,
        modelChannelsPath,
        adminToken: "console-admin-secret",
      });

      try {
        const response = await fetch(`${baseUrl}/api/model-channels`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
          body: JSON.stringify({
            settings: {
              userCanConfigureModels: false,
              channels: [],
              channelGroups: [],
            },
            autoUnassignRemovedChannels: true,
          }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.meta.unassignedInstances).toEqual([
          {
            id: "alpha",
            pool: "shared",
            removedModelChannelId: "openai-main",
            restartRequired: false,
          },
        ]);

        const envFile = await fs.readFile(path.join(root, "alpha", "instance.env"), "utf8");
        expect(envFile).not.toContain("INSTANCE_MODEL_CHANNEL_ID");

        const configFile = JSON.parse(
          await fs.readFile(path.join(root, "alpha", "config", "openclaw.instance.json5"), "utf8"),
        );
        expect(configFile.models).toBeUndefined();
        expect(configFile.agents).toBeUndefined();

        const listResponse = await fetch(`${baseUrl}/api/instances`);
        expect(listResponse.status).toBe(200);
        const listPayload = await listResponse.json();
        expect(listPayload.items[0].modelChannelId).toBeNull();
      } finally {
        await stopServer(server);
      }
    });
  });

  it("rewrites saved instance allowlists when channel contents change", async () => {
    await withTempInstancesRoot(async (root) => {
      const modelChannelsPath = path.join(root, "model-channels.json");
      await fs.writeFile(
        modelChannelsPath,
        JSON.stringify(
          {
            userCanConfigureModels: false,
            channels: [
              {
                id: "openai-main",
                name: "OpenAI Main",
                providerId: "openai-main",
                baseUrl: "https://api.openai.com/v1",
                apiKey: "sk-secret",
                api: "openai-responses",
                models: [
                  {
                    id: "gpt-5-mini",
                    name: "GPT-5 mini",
                    reasoning: true,
                    input: ["text"],
                    contextWindow: 128000,
                    maxTokens: 16000,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
                defaultModel: "openai-main/gpt-5-mini",
              },
            ],
            channelGroups: [],
          },
          null,
          2,
        ),
        "utf8",
      );
      await writeInstance(root, {
        id: "alpha",
        name: "Alpha",
        modelChannelId: "openai-main",
        port: 19111,
      });

      const { server, baseUrl } = await startTestServer({
        root,
        modelChannelsPath,
        adminToken: "console-admin-secret",
      });

      try {
        const response = await fetch(`${baseUrl}/api/model-channels`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
          body: JSON.stringify({
            settings: {
              userCanConfigureModels: false,
              channels: [
                {
                  id: "openai-main",
                  name: "DeepSeek Main",
                  providerId: "deepseek-main",
                  baseUrl: "https://deepseek.example/v1",
                  apiKey: "sk-deepseek",
                  api: "openai-responses",
                  models: [
                    {
                      id: "deepseek-chat",
                      name: "DeepSeek Chat",
                      reasoning: true,
                      input: ["text"],
                      contextWindow: 128000,
                      maxTokens: 16000,
                      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                    },
                  ],
                  defaultModel: "deepseek-main/deepseek-chat",
                },
              ],
              channelGroups: [],
            },
            autoUnassignRemovedChannels: false,
          }),
        });

        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.meta.affectedInstances).toEqual([
          {
            id: "alpha",
            pool: "shared",
            restartRequired: false,
          },
        ]);

        const configFile = JSON.parse(
          await fs.readFile(path.join(root, "alpha", "config", "openclaw.instance.json5"), "utf8"),
        );
        expect(configFile.models.providers).toEqual({
          "deepseek-main": {
            baseUrl: "https://deepseek.example/v1",
            apiKey: "sk-deepseek",
            api: "openai-responses",
            models: [
              {
                id: "deepseek-chat",
                name: "DeepSeek Chat",
                reasoning: true,
                input: ["text"],
                contextWindow: 128000,
                maxTokens: 16000,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              },
            ],
          },
        });
        expect(configFile.agents.defaults).toEqual({
          model: "deepseek-main/deepseek-chat",
          models: {
            "deepseek-main/deepseek-chat": {},
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("creates instances with a mapped channel group and writes a rotating config", async () => {
    await withTempInstancesRoot(async (root) => {
      const modelChannelsPath = path.join(root, "model-channels.json");
      await fs.writeFile(
        modelChannelsPath,
        JSON.stringify(
          {
            userCanConfigureModels: false,
            channels: [
              {
                id: "ice-a",
                name: "ICE A",
                providerId: "ice-a",
                baseUrl: "https://ice-a.example/v1",
                apiKey: "sk-a",
                api: "openai-responses",
                models: [
                  {
                    id: "gpt-5.4",
                    name: "GPT-5.4",
                    reasoning: true,
                    input: ["text"],
                    contextWindow: 128000,
                    maxTokens: 16000,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
                defaultModel: "ice-a/gpt-5.4",
              },
              {
                id: "ice-b",
                name: "ICE B",
                providerId: "ice-b",
                baseUrl: "https://ice-b.example/v1",
                apiKey: "sk-b",
                api: "openai-responses",
                models: [
                  {
                    id: "gpt-5.4",
                    name: "GPT-5.4",
                    reasoning: true,
                    input: ["text"],
                    contextWindow: 128000,
                    maxTokens: 16000,
                    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  },
                ],
                defaultModel: "ice-b/gpt-5.4",
              },
            ],
            channelGroups: [
              {
                id: "ice-rr",
                name: "ICE Round Robin",
                strategy: "round-robin",
                channelIds: ["ice-a", "ice-b"],
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        modelChannelsPath,
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          if (invocation.scriptName === "create-instance.sh") {
            await writeInstance(root, {
              id: "round-robin",
              name: "Round Robin",
              port: 19129,
            });
          }
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
          };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/instances`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "round-robin",
            name: "Round Robin",
            modelChannelId: "ice-rr",
          }),
        });

        expect(response.status).toBe(201);
        const payload = await response.json();
        expect(payload.item.modelChannelId).toBe("ice-rr");
        expect(invocations[0]?.scriptName).toBe("create-instance.sh");

        const configFile = JSON.parse(
          await fs.readFile(
            path.join(root, "round-robin", "config", "openclaw.instance.json5"),
            "utf8",
          ),
        );
        expect(Object.keys(configFile.models.providers)).toEqual(["ice-a", "ice-b"]);
        expect(configFile.agents.defaults.model).toEqual({
          primary: "ice-a/gpt-5.4",
          fallbacks: ["ice-b/gpt-5.4"],
          rotation: {
            strategy: "round-robin",
            stateFile: "shared-console-model-rotation.json",
          },
        });
        expect(configFile.agents.defaults.models).toEqual({
          "ice-a/gpt-5.4": {},
          "ice-b/gpt-5.4": {},
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("creates an instance through ops integration and returns the new record", async () => {
    await withTempInstancesRoot(async (root) => {
      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          if (invocation.scriptName === "create-instance.sh") {
            await writeInstance(root, {
              id: "beta",
              name: "Beta",
              port: 19112,
            });
          }
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
          };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/instances`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "beta",
            name: "Beta",
            port: 19112,
          }),
        });

        expect(response.status).toBe(201);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.item.id).toBe("beta");
        expect(payload.item.name).toBe("Beta");
        expect(invocations).toEqual([
          {
            scriptName: "create-instance.sh",
            args: [
              "beta",
              "--root",
              root,
              "--port",
              "19112",
              "--profile",
              "shared-beta",
              "--name",
              "Beta",
              "--runtime-kind",
              "host",
            ],
          },
        ]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("creates a managed container through ops integration", async () => {
    await withTempInstancesRoot(async (root) => {
      const dedicatedRoot = path.join(root, ".dedicated");
      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          return {
            exitCode: 0,
            stdout: "created",
            stderr: "",
          };
        },
        listDockerContainers: async () => [
          {
            id: "cid-worker",
            name: "openclaw-worker",
            image: "node:22-bookworm-slim",
            state: "running",
            status: "Up 5 seconds",
            createdAt: "2026-04-02 10:00:00 +0800 CST",
            ports: [],
            labels: {
              "ai.openclaw.shared-console": "managed",
            },
          },
        ],
      });

      try {
        const response = await fetch(`${baseUrl}/api/containers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "openclaw-worker",
          }),
        });

        expect(response.status).toBe(201);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.request).toEqual({
          names: ["openclaw-worker"],
          image: "node:22-bookworm-slim",
          command: null,
          pullMissing: true,
        });
        expect(payload.items).toHaveLength(1);
        expect(payload.items[0].name).toBe("openclaw-worker");
        expect(invocations).toEqual([
          {
            scriptName: "create-container.sh",
            args: [
              "--name",
              "openclaw-worker",
              "--image",
              "node:22-bookworm-slim",
              "--repo-root-host",
              root,
              "--shared-instances-root-host",
              root,
              "--dedicated-instances-root-host",
              dedicatedRoot,
              "--repo-root-container",
              root,
              "--shared-instances-root-container",
              root,
              "--dedicated-instances-root-container",
              dedicatedRoot,
              "--pull-missing",
            ],
          },
        ]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("creates multiple managed containers from a prefix", async () => {
    await withTempInstancesRoot(async (root) => {
      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          return {
            exitCode: 0,
            stdout: "created",
            stderr: "",
          };
        },
        listDockerContainers: async () => [
          {
            id: "cid-1",
            name: "openclaw-batch-1",
            image: "node:22-bookworm-slim",
            state: "running",
            status: "Up 5 seconds",
            createdAt: "2026-04-02 10:00:00 +0800 CST",
            ports: [],
            labels: { "ai.openclaw.shared-console": "managed" },
          },
          {
            id: "cid-2",
            name: "openclaw-batch-2",
            image: "node:22-bookworm-slim",
            state: "running",
            status: "Up 5 seconds",
            createdAt: "2026-04-02 10:00:01 +0800 CST",
            ports: [],
            labels: { "ai.openclaw.shared-console": "managed" },
          },
          {
            id: "cid-3",
            name: "openclaw-batch-3",
            image: "node:22-bookworm-slim",
            state: "running",
            status: "Up 5 seconds",
            createdAt: "2026-04-02 10:00:02 +0800 CST",
            ports: [],
            labels: { "ai.openclaw.shared-console": "managed" },
          },
        ],
      });

      try {
        const response = await fetch(`${baseUrl}/api/containers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            namePrefix: "openclaw-batch",
            count: 3,
          }),
        });

        expect(response.status).toBe(201);
        const payload = await response.json();
        expect(payload.request.names).toEqual([
          "openclaw-batch-1",
          "openclaw-batch-2",
          "openclaw-batch-3",
        ]);
        expect(payload.items.map((item: { name: string }) => item.name)).toEqual([
          "openclaw-batch-1",
          "openclaw-batch-2",
          "openclaw-batch-3",
        ]);
        expect(invocations[0]).toMatchObject({
          scriptName: "create-container.sh",
          args: expect.arrayContaining([
            "--name",
            "openclaw-batch-1",
            "--name",
            "openclaw-batch-2",
            "--name",
            "openclaw-batch-3",
          ]),
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("lists dedicated instances from the dedicated root", async () => {
    await withTempInstancesRoot(async (root) => {
      const dedicatedRoot = path.join(root, ".dedicated");
      await writeInstance(dedicatedRoot, {
        id: "solo-a",
        name: "Solo A",
        port: 19121,
        profile: "dedicated-solo-a",
      });

      const server = createSharedConsoleApiServer({
        config: {
          host: "127.0.0.1",
          port: 0,
          sharedInstancesRoot: root,
          dedicatedInstancesRoot: dedicatedRoot,
        },
      });

      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });

      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to resolve test server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const response = await fetch(`${baseUrl}/api/dedicated-instances`);
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.items).toHaveLength(1);
        expect(payload.items[0].id).toBe("solo-a");
        expect(payload.items[0].name).toBe("Solo A");
        expect(payload.meta).toEqual({
          pool: "dedicated",
          instancesRoot: dedicatedRoot,
          includeProbe: false,
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("creates a dedicated container-targeted instance through ops integration", async () => {
    await withTempInstancesRoot(async (root) => {
      const dedicatedRoot = path.join(root, ".dedicated");
      const invocations: OpsCommandInvocation[] = [];
      const server = createSharedConsoleApiServer({
        config: {
          host: "127.0.0.1",
          port: 0,
          sharedInstancesRoot: root,
          dedicatedInstancesRoot: dedicatedRoot,
        },
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          if (invocation.scriptName === "create-instance.sh") {
            await writeInstance(dedicatedRoot, {
              id: "solo-container",
              name: "Solo Container",
              port: 19131,
              profile: "dedicated-solo-container",
              runtimeKind: "container",
              containerName: "crewclaw-solo",
            });
          }
          return {
            exitCode: 0,
            stdout: "ok",
            stderr: "",
          };
        },
      });

      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to resolve test server address.");
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const response = await fetch(`${baseUrl}/api/dedicated-instances`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: "solo-container",
            name: "Solo Container",
            runtimeKind: "container",
            containerName: "crewclaw-solo",
          }),
        });

        expect(response.status).toBe(201);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.pool).toBe("dedicated");
        expect(payload.item.runtime).toEqual({
          location: "container",
          containerName: "crewclaw-solo",
          containerId: null,
        });
        expect(invocations).toEqual([
          {
            scriptName: "create-instance.sh",
            args: [
              "solo-container",
              "--root",
              dedicatedRoot,
              "--profile",
              "dedicated-solo-container",
              "--name",
              "Solo Container",
              "--runtime-kind",
              "container",
              "--container-name",
              "crewclaw-solo",
            ],
          },
        ]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("patches instance name and exposes lifecycle actions", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "gamma",
        name: "Gamma",
        port: 19113,
      });

      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          return {
            exitCode: 0,
            stdout: `ran ${invocation.scriptName}`,
            stderr: "",
          };
        },
      });

      try {
        const patchResponse = await fetch(`${baseUrl}/api/instances/gamma`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: "Gamma Renamed",
          }),
        });
        expect(patchResponse.status).toBe(200);
        const patchPayload = await patchResponse.json();
        expect(patchPayload.item.name).toBe("Gamma Renamed");

        const startResponse = await fetch(`${baseUrl}/api/instances/gamma/start`, {
          method: "POST",
        });
        expect(startResponse.status).toBe(200);
        const startPayload = await startResponse.json();
        expect(startPayload.ok).toBe(true);
        expect(startPayload.action).toBe("start");

        expect(invocations).toEqual([
          {
            scriptName: "start-instance.sh",
            args: ["gamma", "--root", root],
          },
        ]);

        const persistedEnv = await fs.readFile(path.join(root, "gamma", "instance.env"), "utf8");
        expect(persistedEnv).toContain('INSTANCE_NAME="Gamma Renamed"');
      } finally {
        await stopServer(server);
      }
    });
  });

  it("treats container-targeted instances as running when a container pid file is present", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "gamma-container",
        name: "Gamma Container",
        port: 19117,
        runtimeKind: "container",
        containerName: "crewclaw-gamma",
      });
      await fs.writeFile(path.join(root, "gamma-container", "run", "gateway.pid"), "4242\n", "utf8");

      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          return {
            exitCode: 0,
            stdout: "started",
            stderr: "",
          };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/instances/gamma-container/start`, {
          method: "POST",
        });
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.item.runtime).toEqual({
          location: "container",
          containerName: "crewclaw-gamma",
          containerId: null,
        });
        expect(payload.item.process).toEqual({
          state: "running",
          pid: 4242,
        });
        expect(invocations).toEqual([
          {
            scriptName: "start-instance.sh",
            args: ["gamma-container", "--root", root],
          },
        ]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("probes container-targeted instances through docker exec when includeProbe=1", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "theta",
        name: "Theta",
        port: 19118,
        runtimeKind: "container",
        containerName: "crewclaw-theta",
        containerId: "cid-theta",
      });
      await fs.writeFile(path.join(root, "theta", "run", "gateway.pid"), "5151\n", "utf8");

      const dockerInvocations: string[][] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runDockerCommand: async (invocation) => {
          dockerInvocations.push(invocation.args);
          const url = invocation.args.at(-2) ?? "";
          if (url.endsWith("/healthz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
          }
          if (url.endsWith("/readyz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ready: true }), stderr: "" };
          }
          if (url.endsWith("/version")) {
            return { exitCode: 0, stdout: JSON.stringify({ version: "2026.3.24" }), stderr: "" };
          }
          if (url.endsWith("/shared/usage/summary")) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ totalCount: 7, countsByOutcome: { tool_routed_executed: 7 } }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected url: ${url}` };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/instances?includeProbe=1`);
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.items).toHaveLength(1);
        expect(payload.items[0].process).toEqual({
          state: "running",
          pid: 5151,
        });
        expect(payload.items[0].probe).toMatchObject({
          live: true,
          ready: true,
          version: "2026.3.24",
          usageSummary: {
            totalCount: 7,
            countsByOutcome: {
              tool_routed_executed: 7,
            },
          },
        });
        expect(dockerInvocations).toHaveLength(4);
        expect(dockerInvocations.every((args) => args[0] === "exec" && args[1] === "crewclaw-theta")).toBe(true);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("reuses cached diagnostics for repeated container diagnostics requests", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "theta",
        name: "Theta",
        port: 19118,
        runtimeKind: "container",
        containerName: "crewclaw-theta",
        containerId: "cid-theta",
      });
      await fs.writeFile(path.join(root, "theta", "run", "gateway.pid"), "5151\n", "utf8");

      const dockerInvocations: string[][] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        runDockerCommand: async (invocation) => {
          dockerInvocations.push(invocation.args);
          const url = invocation.args.at(-2) ?? "";
          if (url.endsWith("/healthz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ok: true }), stderr: "" };
          }
          if (url.endsWith("/readyz")) {
            return { exitCode: 0, stdout: JSON.stringify({ ready: true }), stderr: "" };
          }
          if (url.endsWith("/version")) {
            return { exitCode: 0, stdout: JSON.stringify({ version: "2026.3.24" }), stderr: "" };
          }
          if (url.endsWith("/shared/usage/summary")) {
            return {
              exitCode: 0,
              stdout: JSON.stringify({ totalCount: 7, countsByOutcome: { tool_routed_executed: 7 } }),
              stderr: "",
            };
          }
          return { exitCode: 1, stdout: "", stderr: `unexpected url: ${url}` };
        },
      });

      try {
        const firstResponse = await fetch(`${baseUrl}/api/instances/theta/diagnostics`);
        expect(firstResponse.status).toBe(200);
        const secondResponse = await fetch(`${baseUrl}/api/instances/theta/diagnostics`);
        expect(secondResponse.status).toBe(200);

        const firstPayload = await firstResponse.json();
        const secondPayload = await secondResponse.json();
        expect(firstPayload.item.probe).toMatchObject({
          live: true,
          ready: true,
          version: "2026.3.24",
        });
        expect(secondPayload.item.probe).toMatchObject({
          live: true,
          ready: true,
          version: "2026.3.24",
        });
        expect(dockerInvocations).toHaveLength(4);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("proxies container instance control-ui HTTP requests through the shared console route", async () => {
    await withTempInstancesRoot(async (root) => {
      const upstreamRequests: Array<{ url: string; origin?: string }> = [];
      const upstream = await startHttpEchoServer((req, res) => {
        upstreamRequests.push({
          url: req.url ?? "/",
          origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, url: req.url ?? "/" }));
      });

      await writeInstance(root, {
        id: "ui-proxy",
        name: "UI Proxy",
        port: upstream.port,
        runtimeKind: "container",
        containerName: "crewclaw-ui-proxy",
      });
      await fs.writeFile(path.join(root, "ui-proxy", "run", "gateway.pid"), "6262\n", "utf8");

      const { server, baseUrl } = await startTestServer({
        root,
        runDockerCommand: async (invocation) => {
          if (invocation.args[0] === "inspect") {
            return {
              exitCode: 0,
              stdout: "127.0.0.1\n",
              stderr: "",
            };
          }
          return {
            exitCode: 1,
            stdout: "",
            stderr: `unexpected docker command: ${invocation.args.join(" ")}`,
          };
        },
      });

      try {
        const response = await fetch(
          `${baseUrl}/api/instances/ui-proxy/ui/__openclaw/control-ui-config.json?source=test`,
          {
            headers: {
              Origin: "http://shared-console.example.test",
            },
          },
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          url: "/__openclaw/control-ui-config.json?source=test",
        });
        expect(upstreamRequests).toEqual([
          {
            url: "/__openclaw/control-ui-config.json?source=test",
            origin: `http://127.0.0.1:${upstream.port}`,
          },
        ]);
      } finally {
        await stopServer(server);
        await stopServer(upstream.server);
      }
    });
  });

  it("proxies instance control-ui websocket traffic through the shared console route", async () => {
    await withTempInstancesRoot(async (root) => {
      const upstreamServer = createHttpServer();
      const upstreamWss = new TestWebSocketServer({ server: upstreamServer });
      const upstreamRequests: Array<{ path: string; origin?: string }> = [];
      upstreamWss.on("connection", (socket, req) => {
        upstreamRequests.push({
          path: req.url ?? "/",
          origin: typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        });
        socket.on("message", (data, isBinary) => {
          socket.send(data, { binary: isBinary });
        });
      });

      await new Promise<void>((resolve, reject) => {
        upstreamServer.once("error", reject);
        upstreamServer.listen(0, "127.0.0.1", () => resolve());
      });
      const upstreamAddress = upstreamServer.address();
      if (!upstreamAddress || typeof upstreamAddress === "string") {
        throw new Error("Failed to resolve websocket upstream address.");
      }

      await writeInstance(root, {
        id: "ws-proxy",
        name: "WS Proxy",
        port: upstreamAddress.port,
      });
      await fs.writeFile(path.join(root, "ws-proxy", "run", "gateway.pid"), `${process.pid}\n`, "utf8");

      const { server, baseUrl } = await startTestServer({ root });
      const proxyWsUrl = `${baseUrl.replace(/^http/, "ws")}/api/instances/ws-proxy/ui/`;

      try {
        const client = new TestWebSocket(proxyWsUrl, {
          headers: {
            Origin: "http://shared-console.example.test",
          },
        });
        await new Promise<void>((resolve, reject) => {
          client.once("open", () => resolve());
          client.once("error", reject);
        });

        client.send("hello-through-proxy");
        await expect(waitForWebSocketMessage(client)).resolves.toBe("hello-through-proxy");
        expect(upstreamRequests).toEqual([
          {
            path: "/",
            origin: `http://127.0.0.1:${upstreamAddress.port}`,
          },
        ]);

        client.close();
        await new Promise<void>((resolve) => client.once("close", () => resolve()));
      } finally {
        upstreamWss.close();
        await stopServer(upstreamServer);
        await stopServer(server);
      }
    });
  });

  it("validates admin mode and returns an instance token only for authorized requests", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "admin-token",
        runtimeKind: "container",
        containerName: "crewclaw-admin-token",
        proxyToken: "instance-token-123",
      });

      const { server, baseUrl } = await startTestServer({
        root,
        adminToken: "console-admin-secret",
      });

      try {
        const forbidden = await fetch(`${baseUrl}/api/admin/validate`);
        expect(forbidden.status).toBe(403);

        const validated = await fetch(`${baseUrl}/api/admin/validate`, {
          headers: {
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
        });
        expect(validated.status).toBe(200);
        expect(await validated.json()).toEqual({
          ok: true,
          admin: true,
        });

        const tokenResponse = await fetch(`${baseUrl}/api/instances/admin-token/token`, {
          headers: {
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
        });
        expect(tokenResponse.status).toBe(200);
        expect(await tokenResponse.json()).toEqual({
          ok: true,
          item: {
            id: "admin-token",
            pool: "shared",
            token: "instance-token-123",
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("lists and approves instance device pairing entries only for authorized admin requests", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "pairing-alpha",
      });

      const invocations: OpsCommandInvocation[] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        adminToken: "console-admin-secret",
        runOpsCommand: async (invocation) => {
          invocations.push(invocation);
          if (invocation.scriptName !== "pairing-instance.sh") {
            return {
              exitCode: 1,
              stdout: "",
              stderr: `unexpected script ${invocation.scriptName}`,
            };
          }
          if (invocation.args[0] === "list") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                pending: [
                  {
                    requestId: "req-1",
                    deviceId: "dev-1",
                    displayName: "Chrome",
                    role: "operator",
                    scopes: ["operator.read"],
                  },
                ],
                paired: [],
              }),
              stderr: "",
            };
          }
          if (invocation.args[0] === "approve-latest") {
            return {
              exitCode: 0,
              stdout: JSON.stringify({
                requestId: "req-1",
                device: {
                  deviceId: "dev-1",
                },
              }),
              stderr: "",
            };
          }
          return {
            exitCode: 1,
            stdout: "",
            stderr: `unexpected args ${invocation.args.join(" ")}`,
          };
        },
      });

      try {
        const forbidden = await fetch(`${baseUrl}/api/instances/pairing-alpha/pairing`);
        expect(forbidden.status).toBe(403);

        const listResponse = await fetch(`${baseUrl}/api/instances/pairing-alpha/pairing`, {
          headers: {
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
        });
        expect(listResponse.status).toBe(200);
        expect(await listResponse.json()).toEqual({
          ok: true,
          item: {
            id: "pairing-alpha",
            pool: "shared",
            pairing: {
              pending: [
                {
                  requestId: "req-1",
                  deviceId: "dev-1",
                  displayName: "Chrome",
                  role: "operator",
                  scopes: ["operator.read"],
                },
              ],
              paired: [],
            },
          },
        });

        const approveResponse = await fetch(`${baseUrl}/api/instances/pairing-alpha/pairing/approve-latest`, {
          method: "POST",
          headers: {
            "X-Shared-Console-Admin-Token": "console-admin-secret",
          },
        });
        expect(approveResponse.status).toBe(200);
        expect(await approveResponse.json()).toEqual({
          ok: true,
          action: "approve-latest",
          item: {
            id: "pairing-alpha",
            pool: "shared",
            pairing: {
              pending: [
                {
                  requestId: "req-1",
                  deviceId: "dev-1",
                  displayName: "Chrome",
                  role: "operator",
                  scopes: ["operator.read"],
                },
              ],
              paired: [],
            },
          },
          result: {
            requestId: "req-1",
            device: {
              deviceId: "dev-1",
            },
          },
        });

        expect(invocations).toEqual([
          {
            scriptName: "pairing-instance.sh",
            args: ["list", "pairing-alpha", "--root", root],
          },
          {
            scriptName: "pairing-instance.sh",
            args: ["approve-latest", "pairing-alpha", "--root", root],
          },
          {
            scriptName: "pairing-instance.sh",
            args: ["list", "pairing-alpha", "--root", root],
          },
        ]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("lists relevant containers and attached instances", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "delta",
        name: "Delta",
        port: 19114,
        runtimeKind: "container",
        containerName: "crewclaw-gateway",
        containerId: "abc123",
      });

      const { server, baseUrl } = await startTestServer({
        root,
        listDockerContainers: async () => [
          {
            id: "abc123",
            name: "crewclaw-gateway",
            image: "crewclaw:local",
            state: "running",
            status: "Up 2 hours",
            createdAt: "2026-04-01 10:00:00 +0800 CST",
            ports: ["0.0.0.0:43100->43100/tcp"],
            labels: {
              "com.docker.compose.project": "crewclaw",
            },
          },
          {
            id: "zzz999",
            name: "redis",
            image: "redis:7",
            state: "running",
            status: "Up 3 hours",
            createdAt: "2026-04-01 09:00:00 +0800 CST",
            ports: ["6379/tcp"],
            labels: {},
          },
        ],
      });

      try {
        const response = await fetch(`${baseUrl}/api/containers`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          items: [
            {
              id: "abc123",
              name: "crewclaw-gateway",
              image: "crewclaw:local",
              state: "running",
              status: "Up 2 hours",
              createdAt: "2026-04-01 10:00:00 +0800 CST",
              ports: ["0.0.0.0:43100->43100/tcp"],
              labels: {
                "com.docker.compose.project": "crewclaw",
              },
              source: "docker",
              attachedInstances: [
                {
                  id: "delta",
                  name: "Delta",
                },
              ],
            },
          ],
          meta: {
            available: true,
            error: null,
            totalDockerContainers: 2,
            relevantContainerCount: 1,
            linkedContainerCount: 1,
            hostInstanceCount: 0,
            containerInstanceCount: 1,
            hiddenDockerContainerCount: 1,
          },
        });
      } finally {
        await stopServer(server);
      }
    });
  });

  it("runs container lifecycle actions through docker integration", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "epsilon",
        name: "Epsilon",
        port: 19115,
        runtimeKind: "container",
        containerName: "crewclaw-epsilon",
        containerId: "cid-epsilon",
      });

      const invocations: string[][] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        listDockerContainers: async () => [
          {
            id: "cid-epsilon",
            name: "crewclaw-epsilon",
            image: "crewclaw:test",
            state: "exited",
            status: "Exited (0) 1 minute ago",
            createdAt: "2026-04-01 10:30:00 +0800 CST",
            ports: [],
            labels: {},
          },
        ],
        runDockerCommand: async (invocation) => {
          invocations.push(invocation.args);
          return {
            exitCode: 0,
            stdout: "started",
            stderr: "",
          };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/containers/crewclaw-epsilon/start`, {
          method: "POST",
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          action: "start",
          item: {
            id: "cid-epsilon",
            name: "crewclaw-epsilon",
            image: "crewclaw:test",
            state: "exited",
            status: "Exited (0) 1 minute ago",
            createdAt: "2026-04-01 10:30:00 +0800 CST",
            ports: [],
            labels: {},
            source: "docker",
            attachedInstances: [
              {
                id: "epsilon",
                name: "Epsilon",
              },
            ],
          },
          command: {
            engine: "docker",
            stdout: "started",
            stderr: "",
            exitCode: 0,
          },
        });
        expect(invocations).toEqual([["start", "crewclaw-epsilon"]]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("reads container logs through docker integration", async () => {
    await withTempInstancesRoot(async (root) => {
      await writeInstance(root, {
        id: "zeta",
        name: "Zeta",
        port: 19116,
        runtimeKind: "container",
        containerName: "crewclaw-zeta",
        containerId: "cid-zeta",
      });

      const invocations: string[][] = [];
      const { server, baseUrl } = await startTestServer({
        root,
        listDockerContainers: async () => [
          {
            id: "cid-zeta",
            name: "crewclaw-zeta",
            image: "crewclaw:test",
            state: "running",
            status: "Up 5 minutes",
            createdAt: "2026-04-01 11:00:00 +0800 CST",
            ports: ["0.0.0.0:43100->43100/tcp"],
            labels: {},
          },
        ],
        runDockerCommand: async (invocation) => {
          invocations.push(invocation.args);
          return {
            exitCode: 0,
            stdout: "line-1\nline-2\n",
            stderr: "",
          };
        },
      });

      try {
        const response = await fetch(`${baseUrl}/api/containers/crewclaw-zeta/logs?tail=20`);
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
          ok: true,
          item: {
            id: "cid-zeta",
            name: "crewclaw-zeta",
            image: "crewclaw:test",
            state: "running",
            status: "Up 5 minutes",
            createdAt: "2026-04-01 11:00:00 +0800 CST",
            ports: ["0.0.0.0:43100->43100/tcp"],
            labels: {},
            source: "docker",
            attachedInstances: [
              {
                id: "zeta",
                name: "Zeta",
              },
            ],
          },
          logs: {
            tail: 20,
            text: "line-1\nline-2",
          },
        });
        expect(invocations).toEqual([["logs", "--tail", "20", "crewclaw-zeta"]]);
      } finally {
        await stopServer(server);
      }
    });
  });

  it("lists all docker containers when containers all=1 is requested", async () => {
    await withTempInstancesRoot(async (root) => {
      const { server, baseUrl } = await startTestServer({
        root,
        listDockerContainers: async () => [
          {
            id: "cid-app",
            name: "crewclaw-app",
            image: "crewclaw:test",
            state: "running",
            status: "Up 1 minute",
            createdAt: "2026-04-01 11:10:00 +0800 CST",
            ports: [],
            labels: {},
          },
          {
            id: "cid-db",
            name: "postgres",
            image: "postgres:16",
            state: "running",
            status: "Up 3 minutes",
            createdAt: "2026-04-01 11:09:00 +0800 CST",
            ports: [],
            labels: {},
          },
        ],
      });

      try {
        const response = await fetch(`${baseUrl}/api/containers?all=1`);
        expect(response.status).toBe(200);
        const payload = await response.json();
        expect(payload.ok).toBe(true);
        expect(payload.items.map((item: { name: string }) => item.name)).toEqual([
          "crewclaw-app",
          "postgres",
        ]);
        expect(payload.meta.hiddenDockerContainerCount).toBe(0);
      } finally {
        await stopServer(server);
      }
    });
  });
});
