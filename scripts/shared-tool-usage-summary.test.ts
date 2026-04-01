import { describe, expect, it } from "vitest";

import type { SharedToolUsageSummary } from "../src/multitenant/usage/usage-summary.js";
import { __testing } from "./shared-tool-usage-summary.helpers.js";

describe("shared-tool-usage-summary script helpers", () => {
  it("formats a readable report including rule and denied-reason sections", () => {
    const summary: SharedToolUsageSummary = {
      totalCount: 3,
      countsByOutcome: { tool_policy_denied: 1, tool_local_executed: 2 },
      countsByToolName: { message: 2, image: 1 },
      countsByToolNameAction: { "message:sendAttachment": 2, "image:": 1 },
      countsByRouteType: { deny: 1, local: 2 },
      countsByRuleId: { "shared.message.buffer-too-large.deny.v1": 1 },
      countsByDeniedReason: { "共享模式仅支持轻量消息媒体能力：buffer 不能超过 2 MB": 1 },
    };

    const report = __testing.formatSummaryReport({
      filePath: "E:/tmp/shared-tool-usage.jsonl",
      summary,
      totalEvents: 3,
    });

    expect(report).toContain("# Shared Tool Usage Summary");
    expect(report).toContain("## By ruleId");
    expect(report).toContain("shared.message.buffer-too-large.deny.v1: 1");
    expect(report).toContain("## By denied reason");
    expect(report).toContain("共享模式仅支持轻量消息媒体能力：buffer 不能超过 2 MB: 1");
  });

  it("parses --json and file path args", () => {
    expect(__testing.parseArgs(["usage.jsonl", "--json"])).toEqual({
      filePath: "usage.jsonl",
      json: true,
    });
  });
});
