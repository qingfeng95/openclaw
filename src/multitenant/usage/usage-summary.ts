import fs from "node:fs";
import type { SharedToolUsageEvent } from "./event-types.js";

export interface ReadSharedToolUsageEventsOptions {
  ignoreInvalidLines?: boolean;
}

export interface SharedToolUsageSummary {
  totalCount: number;
  countsByOutcome: Record<string, number>;
  countsByToolName: Record<string, number>;
  countsByToolNameAction: Record<string, number>;
  countsByRouteType: Record<string, number>;
  countsByRuleId: Record<string, number>;
  countsByDeniedReason: Record<string, number>;
}

function incrementCount(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function getToolNameActionKey(event: SharedToolUsageEvent): string {
  return `${event.toolName}:${event.action ?? ""}`;
}

function resolveDeniedReason(event: SharedToolUsageEvent): string | undefined {
  if (typeof event.deniedReason === "string" && event.deniedReason.trim()) {
    return event.deniedReason;
  }
  if (typeof event.reason === "string" && event.reason.trim()) {
    return event.reason;
  }
  return undefined;
}

export function summarizeSharedToolUsageEvents(
  events: readonly SharedToolUsageEvent[],
): SharedToolUsageSummary {
  const summary: SharedToolUsageSummary = {
    totalCount: events.length,
    countsByOutcome: {},
    countsByToolName: {},
    countsByToolNameAction: {},
    countsByRouteType: {},
    countsByRuleId: {},
    countsByDeniedReason: {},
  };

  for (const event of events) {
    incrementCount(summary.countsByOutcome, event.outcome);
    incrementCount(summary.countsByToolName, event.toolName);
    incrementCount(summary.countsByToolNameAction, getToolNameActionKey(event));
    incrementCount(summary.countsByRouteType, event.routeType);

    if (typeof event.ruleId === "string" && event.ruleId.trim()) {
      incrementCount(summary.countsByRuleId, event.ruleId);
    }

    if (event.outcome === "tool_policy_denied" || event.outcome === "tool_route_unavailable") {
      const deniedReason = resolveDeniedReason(event);
      if (deniedReason) {
        incrementCount(summary.countsByDeniedReason, deniedReason);
      }
    }
  }

  return summary;
}

export function readSharedToolUsageEvents(
  filePath: string,
  options: ReadSharedToolUsageEventsOptions = {},
): SharedToolUsageEvent[] {
  const content = fs.readFileSync(filePath, "utf8");
  const events: SharedToolUsageEvent[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      events.push(JSON.parse(trimmed) as SharedToolUsageEvent);
    } catch (error) {
      if (options.ignoreInvalidLines) {
        continue;
      }
      throw new Error(
        `Failed to parse shared tool usage event at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return events;
}
