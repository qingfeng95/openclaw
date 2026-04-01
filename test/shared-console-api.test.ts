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
      `INSTANCE_PORT="${params.port ?? 19100}"`,
      `INSTANCE_PROFILE="${params.profile ?? `shared-${params.id}`}"`,
      `INSTANCE_BIND="${params.bind ?? "loopback"}"`,
      `INSTANCE_TEMPLATE="${params.template ?? "internal-test"}"`,
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
}) {
  const server = createSharedConsoleApiServer({
    config: {
      host: "127.0.0.1",
      port: 0,
      instancesRoot: params.root,
    },
    runOpsCommand: params.runOpsCommand,
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
            args: ["beta", "--root", root, "--port", "19112", "--name", "Beta"],
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
});
