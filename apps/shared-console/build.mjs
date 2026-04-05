import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, "../../dist/shared-console");

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

for (const fileName of ["index.html", "styles.css", "app.js", "instance-detail.js", "instance-requests.js", "instance-list-load.js", "model-channel-generator.js", "model-channel-panel.js", "detail-panel.js", "detail-render.js", "pairing-render.js", "shared-console-core.js", "shared-console-utils.js", "README.md"]) {
  await fs.copyFile(path.join(here, fileName), path.join(outDir, fileName));
}

const apiBase =
  process.env.SHARED_CONSOLE_API_BASE?.trim() || "http://127.0.0.1:43100";
await fs.writeFile(
  path.join(outDir, "config.json"),
  JSON.stringify({ apiBase }, null, 2),
  "utf8",
);

process.stdout.write(`[shared-console] built static bundle at ${outDir}\n`);
