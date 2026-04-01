import { describe, expect, it } from "vitest";

import type { SharedToolUsageSummary } from "./usage-summary.js";
import { formatSummaryReport, parseSharedToolUsageSummaryArgs } from "../../../scripts/shared-tool-usage-summary.helpers.js";

describe("shared tool usage summary report helpers", () => {
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

    const report = formatSummaryReport({
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
    expect(parseSharedToolUsageSummaryArgs(["usage.jsonl", "--json"])).toEqual({
      filePath: "usage.jsonl",
      json: true,
    });
  });

  it("formats an empty-log notice cleanly", () => {
    const report = "# Shared Tool Usage Summary\n- File: E:/tmp/shared-tool-usage.jsonl\n- Total events: 0\n\nNo shared tool usage log found.\n";
    expect(report).toContain("No shared tool usage log found.");
  });
});

