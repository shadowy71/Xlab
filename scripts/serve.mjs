import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const siteRoot = path.resolve(projectRoot, process.argv[2] || ".");
const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);

if (!siteRoot.startsWith(`${projectRoot}${path.sep}`) && siteRoot !== projectRoot) {
  console.error("The served directory must be inside the project.");
  process.exit(1);
}
if (!fs.existsSync(path.join(siteRoot, "index.html"))) {
  console.error(`No index.html found in ${siteRoot}. Run "npm run build" first if serving dist/.`);
  process.exit(1);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  let pathname;
  try {
    const base = `http://${req.headers.host || "localhost"}`;
    pathname = decodeURIComponent(new URL(req.url || "/", base).pathname);
  } catch {
    sendText(res, 400, "Bad request");
    return;
  }

  if (pathname === "/" || pathname === "") pathname = "/index.html";
  const filePath = path.resolve(siteRoot, `.${pathname}`);
  if (!filePath.startsWith(`${siteRoot}${path.sep}`)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      sendText(res, 404, "Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
});

server.on("error", (error) => {
  console.error(`Could not start server: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`PCCOE Lab running at http://${host}:${port}`);
});
