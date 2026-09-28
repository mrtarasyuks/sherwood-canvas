import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
const T = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
createServer((q, r) => {
  const p = join("docs", decodeURIComponent(q.url.split("?")[0]).replace(/\/$/, "/index.html"));
  if (!existsSync(p)) { r.writeHead(404); return r.end("nf"); }
  r.writeHead(200, { "content-type": T[extname(p)] ?? "application/octet-stream" }); r.end(readFileSync(p));
}).listen(Number(process.argv[2] ?? 8799), "127.0.0.1", () => console.log("serving site on", process.argv[2] ?? 8799));
