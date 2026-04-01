import { describe, expect, it, vi } from "vitest";

import {
  routeBrowserTool,
  routeNodesTool,
  type ToolRoutingResult,
} from "./tool-routing.js";

vi.mock("../../config/io.js", () => ({
  loadConfig: vi.fn(() => ({ browser: { sharedRoutedExecutionEnabled: false } })),
}));

async function runBrowserRoute(params?: {
  action?: string;
  enabled?: boolean;
  execute?: ((toolCallId: string, args: Record<string, unknown>) => unknown) | undefined;
}): Promise<ToolRoutingResult> {
  const { loadConfig } = await import("../../config/io.js");
  vi.mocked(loadConfig).mockReturnValue({
    browser: { sharedRoutedExecutionEnabled: params?.enabled ?? false },
  } as never);

  return await routeBrowserTool({
    runtimeScope: { mode: "shared" } as never,
    toolName: "browser",
    toolArgs: { action: params?.action ?? "status" },
    toolCallId: "call-1",
    policyDecision: {
      allow: true,
      reason: "worker route",
      ruleId: "rule-1",
      resourceClass: "browser",
      supportLevel: "stable",
      route: "worker",
    },
    tool: {
      name: "browser",
      execute: params?.execute,
    },
  });
}

async function runNodesRoute(params?: {
  action?: string;
  node?: string;
  execute?: ((toolCallId: string, args: Record<string, unknown>) => unknown) | undefined;
}): Promise<ToolRoutingResult> {
  return await routeNodesTool({
    runtimeScope: { mode: "shared" } as never,
    toolName: "nodes",
    toolArgs: {
      action: params?.action ?? "status",
      ...(params?.node ? { node: params.node } : {}),
    },
    toolCallId: "call-2",
    policyDecision: {
      allow: false,
      reason: "nodes disabled in shared baseline",
      ruleId: "rule-2",
      resourceClass: "nodes",
      supportLevel: "unsupported",
      route: "deny",
    },
    tool: {
      name: "nodes",
      execute: params?.execute,
    },
  });
}

describe("tool routing", () => {
  it("routes shared browser status to execution when switch is enabled and tool.execute exists", async () => {
    const execute = vi.fn(async () => ({ ok: true, source: "browser-status" }));

    const result = await runBrowserRoute({
      action: "status",
      enabled: true,
      execute,
    });

    expect(result).toMatchObject({
      mode: "worker",
      executed: true,
      workerKind: "browser",
      result: { ok: true, source: "browser-status" },
    });
    expect(execute).toHaveBeenCalledWith("call-1", { action: "status" });
  });

  it("routes shared browser profiles to execution when switch is enabled", async () => {
    const execute = vi.fn(async () => ({ ok: true, source: "browser-profiles" }));

    const result = await runBrowserRoute({
      action: "profiles",
      enabled: true,
      execute,
    });

    expect(result).toMatchObject({
      mode: "worker",
      executed: true,
      workerKind: "browser",
      result: { ok: true, source: "browser-profiles" },
    });
    expect(execute).toHaveBeenCalledWith("call-1", { action: "profiles" });
  });

  it("routes shared browser tabs to execution when switch is enabled", async () => {
    const execute = vi.fn(async () => ({ ok: true, source: "browser-tabs" }));

    const result = await runBrowserRoute({
      action: "tabs",
      enabled: true,
      execute,
    });

    expect(result).toMatchObject({
      mode: "worker",
      executed: true,
      workerKind: "browser",
      result: { ok: true, source: "browser-tabs" },
    });
    expect(execute).toHaveBeenCalledWith("call-1", { action: "tabs" });
  });

  it("returns unavailable for shared browser navigate", async () => {
    const result = await runBrowserRoute({
      action: "navigate",
      enabled: true,
      execute: vi.fn(),
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "browser",
    });
  });

  it("returns unavailable for shared nodes status in the 2026-03-28 baseline", async () => {
    const execute = vi.fn(async () => ({ ok: true, source: "nodes-status" }));

    const result = await runNodesRoute({
      action: "status",
      execute,
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "nodes",
      reason: "共享模式暂不支持 nodes 能力，请改用独立实例 (action: status)",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns unavailable for shared nodes describe in the 2026-03-28 baseline", async () => {
    const execute = vi.fn(async () => ({ ok: true, source: "nodes-describe" }));

    const result = await runNodesRoute({
      action: "describe",
      node: "macbook",
      execute,
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "nodes",
      reason: "共享模式暂不支持 nodes 能力，请改用独立实例 (action: describe)",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns unavailable for shared nodes pending as part of the 2026-03-28 baseline", async () => {
    const execute = vi.fn(async () => ({ ok: true }));

    const result = await runNodesRoute({
      action: "pending",
      execute,
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "nodes",
      reason: "共享模式暂不支持 nodes 能力，请改用独立实例 (action: pending)",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns unavailable for shared nodes run as part of the 2026-03-28 baseline", async () => {
    const execute = vi.fn(async () => ({ ok: true }));

    const result = await runNodesRoute({
      action: "run",
      execute,
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "nodes",
      reason: "共享模式暂不支持 nodes 能力，请改用独立实例 (action: run)",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns unavailable for shared nodes camera_snap in the 2026-03-28 baseline", async () => {
    const execute = vi.fn(async () => ({ ok: true }));

    const result = await runNodesRoute({
      action: "camera_snap",
      execute,
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "nodes",
      reason: "共享模式暂不支持 nodes 能力，请改用独立实例 (action: camera_snap)",
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns unavailable for shared browser navigate as part of the stage-2 baseline freeze", async () => {
    const result = await runBrowserRoute({
      action: "navigate",
      enabled: true,
      execute: vi.fn(),
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "browser",
      reason: "shared browser route does not allow action: navigate",
    });
  });

  it("returns unavailable for shared browser status when switch is disabled", async () => {
    const execute = vi.fn(async () => ({ ok: true }));

    const result = await runBrowserRoute({
      action: "status",
      enabled: false,
      execute,
    });

    expect(result).toMatchObject({
      mode: "unavailable",
      executed: false,
      workerKind: "browser",
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
