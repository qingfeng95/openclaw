import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const host = process.env.SHARED_CONSOLE_HOST?.trim() || "127.0.0.1";
const port = Number.parseInt(process.env.SHARED_CONSOLE_PORT ?? "43101", 10);
const apiBase =
  process.env.SHARED_CONSOLE_API_BASE?.trim() ||
  `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:43100`;

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".ico", "image/x-icon"],
]);

function resolveFilePath(urlPathname) {
  const cleanedPath = decodeURIComponent(urlPathname.split("?")[0]).replace(/^\/+/, "");
  const relativePath = cleanedPath || "index.html";
  const resolved = path.resolve(here, relativePath);
  if (!resolved.startsWith(here)) {
    return null;
  }
  return resolved;
}

async function sendFile(res, filePath) {
  const stat = await fs.stat(filePath);
  if (stat.isDirectory()) {
    return await sendFile(res, path.join(filePath, "index.html"));
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", contentTypes.get(path.extname(filePath)) || "application/octet-stream");
  createReadStream(filePath).pipe(res);
}

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

      if (url.pathname === "/healthz") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: true, status: "live", apiBase }));
        return;
      }

      if (url.pathname === "/config.json") {
        res.statusCode = 200;
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ apiBase }));
        return;
      }

      const filePath = resolveFilePath(url.pathname);
      if (!filePath) {
        res.statusCode = 403;
        res.end("Forbidden");
        return;
      }

      try {
        await sendFile(res, filePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          await sendFile(res, path.join(here, "index.html"));
          return;
        }
        throw error;
      }
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(error instanceof Error ? error.stack ?? error.message : String(error));
    }
  })();
});

server.listen(port, host, () => {
  process.stdout.write(
    `[shared-console] listening on http://${host}:${port} (apiBase=${apiBase})\n`,
  );
});
