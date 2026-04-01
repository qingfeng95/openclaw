import { resolveSharedToolUsageLogPath } from "../src/multitenant/usage/usage-reporter.js";
import type { SharedToolUsageSummary } from "../src/multitenant/usage/usage-summary.js";

function sortCountsDescending(counts: Record<string, number>): Array<[string, number]> {
  return Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
}

function formatCountSection(title: string, counts: Record<string, number>, limit = 10): string[] {
  const entries = sortCountsDescending(counts).slice(0, limit);
  const lines = [`## ${title}`];
  if (entries.length === 0) {
    lines.push("- <none>");
    return lines;
  }
  for (const [key, value] of entries) {
    lines.push(`- ${key}: ${value}`);
  }
  return lines;
}

export function formatSummaryReport(params: {
  filePath: string;
  summary: SharedToolUsageSummary;
  totalEvents: number;
}): string {
  const { filePath, summary, totalEvents } = params;
  const lines: string[] = [];
  lines.push("# Shared Tool Usage Summary");
  lines.push(`- File: ${filePath}`);
  lines.push(`- Total events: ${totalEvents}`);
  lines.push("");

  lines.push(...formatCountSection("By outcome", summary.countsByOutcome));
  lines.push("");
  lines.push(...formatCountSection("By tool", summary.countsByToolName));
  lines.push("");
  lines.push(...formatCountSection("By tool+action", summary.countsByToolNameAction));
  lines.push("");
  lines.push(...formatCountSection("By route type", summary.countsByRouteType));
  lines.push("");
  lines.push(...formatCountSection("By ruleId", summary.countsByRuleId));
  lines.push("");
  lines.push(...formatCountSection("By denied reason", summary.countsByDeniedReason));

  return `${lines.join("\n")}\n`;
}

export function parseSharedToolUsageSummaryArgs(argv: string[]): { filePath: string; json: boolean } {
  let filePath = resolveSharedToolUsageLogPath();
  let json = false;

  for (const arg of argv) {
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (!arg.startsWith("-")) {
      filePath = arg;
    }
  }

  return { filePath, json };
}
