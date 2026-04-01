import fs from "node:fs";
import process from "node:process";

import { readSharedToolUsageEvents, summarizeSharedToolUsageEvents } from "../src/multitenant/usage/usage-summary.js";
import { formatSummaryReport, parseSharedToolUsageSummaryArgs } from "./shared-tool-usage-summary.helpers.js";

function main(): void {
  const { filePath, json } = parseSharedToolUsageSummaryArgs(process.argv.slice(2));

  if (!fs.existsSync(filePath)) {
    if (json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            totalCount: 0,
            countsByOutcome: {},
            countsByToolName: {},
            countsByToolNameAction: {},
            countsByRouteType: {},
            countsByRuleId: {},
            countsByDeniedReason: {},
            filePath,
            note: "No shared tool usage log found.",
          },
          null,
          2,
        )}\n`,
      );
      return;
    }

    process.stdout.write(`# Shared Tool Usage Summary\n- File: ${filePath}\n- Total events: 0\n\nNo shared tool usage log found.\n`);
    return;
  }

  const events = readSharedToolUsageEvents(filePath, { ignoreInvalidLines: true });
  const summary = summarizeSharedToolUsageEvents(events);

  if (json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    formatSummaryReport({
      filePath,
      summary,
      totalEvents: events.length,
    }),
  );
}

main();
