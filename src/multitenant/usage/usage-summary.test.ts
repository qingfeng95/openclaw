import { describe, expect, it } from "vitest";

import type { SharedToolUsageEvent } from "./event-types.js";
import { summarizeSharedToolUsageEvents } from "./usage-summary.js";

describe("summarizeSharedToolUsageEvents", () => {
  it("aggregates outcome, tool, tool+action, route, rule, and denied-reason counts", () => {
    const events: SharedToolUsageEvent[] = [
      {
        ts: "2026-03-27T00:00:00.000Z",
        toolName: "browser",
        action: "status",
        outcome: "tool_routed_executed",
        routeType: "worker",
        ruleId: "shared.browser.worker.v1",
      },
      {
        ts: "2026-03-27T00:00:01.000Z",
        toolName: "browser",
        action: "status",
        outcome: "tool_routed_executed",
        routeType: "worker",
        ruleId: "shared.browser.worker.v1",
      },
      {
        ts: "2026-03-27T00:00:02.000Z",
        timestamp: "2026-03-27T00:00:02.000Z",
        instanceId: "shared-a",
        toolName: "browser",
        action: "navigate",
        outcome: "tool_route_unavailable",
        routeType: "worker",
        ruleId: "shared.browser.worker.v1",
        deniedReason: "shared browser route does not allow action: navigate",
      },
      {
        ts: "2026-03-27T00:00:03.000Z",
        toolName: "bash",
        outcome: "tool_local_executed",
        routeType: "local",
      },
      {
        ts: "2026-03-27T00:00:04.000Z",
        toolName: "message",
        action: "sendAttachment",
        outcome: "tool_policy_denied",
        routeType: "deny",
        ruleId: "shared.message.buffer-too-large.deny.v1",
        reason: "共享模式仅支持轻量消息媒体能力：buffer 不能超过 2 MB",
      },
    ];

    expect(summarizeSharedToolUsageEvents(events)).toEqual({
      totalCount: 5,
      countsByOutcome: {
        tool_routed_executed: 2,
        tool_route_unavailable: 1,
        tool_local_executed: 1,
        tool_policy_denied: 1,
      },
      countsByToolName: {
        browser: 3,
        bash: 1,
        message: 1,
      },
      countsByToolNameAction: {
        "browser:status": 2,
        "browser:navigate": 1,
        "bash:": 1,
        "message:sendAttachment": 1,
      },
      countsByRouteType: {
        worker: 3,
        local: 1,
        deny: 1,
      },
      countsByRuleId: {
        "shared.browser.worker.v1": 3,
        "shared.message.buffer-too-large.deny.v1": 1,
      },
      countsByDeniedReason: {
        "shared browser route does not allow action: navigate": 1,
        "共享模式仅支持轻量消息媒体能力：buffer 不能超过 2 MB": 1,
      },
    });
  });

  it("prefers deniedReason and falls back to reason during schema migration", () => {
    const events: SharedToolUsageEvent[] = [
      {
        ts: "2026-03-27T00:01:00.000Z",
        toolName: "browser",
        action: "navigate",
        outcome: "tool_route_unavailable",
        routeType: "worker",
        reason: "legacy reason",
        deniedReason: "new reason",
      },
      {
        ts: "2026-03-27T00:01:01.000Z",
        toolName: "message",
        action: "sendAttachment",
        outcome: "tool_policy_denied",
        routeType: "deny",
        reason: "legacy-only reason",
      },
    ];

    expect(summarizeSharedToolUsageEvents(events).countsByDeniedReason).toEqual({
      "new reason": 1,
      "legacy-only reason": 1,
    });
  });
});
