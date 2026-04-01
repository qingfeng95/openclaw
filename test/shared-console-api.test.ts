import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
    port?: number;
    profile?: string;
    bind?: string;
    template?: string;
    runtimeKind?: "host" | "container";
    containerName?: string;
    containerId?: string;
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
      `INSTANCE_DIR="${instanceDir}"`,
      `INSTANCE_ROOT="${root}"`,
      `INSTANCE_RUNTIME_KIND="${params.runtimeKind ?? "host"}"`,
      `INSTANCE_PORT="${params.port ?? 19100}"`,
      `INSTANCE_PROFILE="${params.profile ?? `shared-${params.id}`}"`,
      `INSTANCE_BIND="${params.bind ?? "loopback"}"`,
      `INSTANCE_TEMPLATE="${params.template ?? "internal-test"}"`,
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
}) {
  const server = createSharedConsoleApiServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      sharedInstancesRoot: params.root,
      dedicatedInstancesRoot: path.join(params.root, ".dedicated"),
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
