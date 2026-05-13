import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { exec } from "node:child_process";
import { generateSessionToken, verifySessionToken } from "./security/sessionToken.mjs";
import { validateRpcRequest } from "./security/validateRpcRequest.mjs";
import { RPC, STATE_CHANGING } from "./rpc.mjs";
import { log } from "./lib/logger.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, "..", "ui");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function openInBrowser(url) {
  const cmd =
    process.platform === "win32"
      ? `start "" "${url}"`
      : process.platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) log.warn("could not auto-open browser", { url, error: err.message });
  });
}

async function serveStatic(req, res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  // Strip query strings & guard against traversal
  rel = rel.split("?")[0];
  if (rel.includes("..")) {
    res.writeHead(400).end("bad path");
    return;
  }
  try {
    const full = join(UI_DIR, rel);
    const body = await readFile(full);
    res.writeHead(200, { "content-type": MIME[extname(full)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}

async function readJsonBody(req) {
  return new Promise((resolveP, rejectP) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      if (!buf) return resolveP({});
      try {
        resolveP(JSON.parse(buf));
      } catch (e) {
        rejectP(e);
      }
    });
    req.on("error", rejectP);
  });
}

async function handleRpc(req, res, host) {
  const v = validateRpcRequest(req, host);
  if (!v.ok) {
    log.warn("rpc rejected", { reason: v.reason });
    res.writeHead(v.status).end(v.reason);
    return;
  }
  const url = new URL(req.url, `http://${host}`);
  const method = url.pathname.replace(/^\/rpc\//, "");
  const fn = RPC[method];
  if (!fn) {
    res.writeHead(404).end("unknown method");
    return;
  }
  const isStateChanging = STATE_CHANGING.has(method);
  if (isStateChanging && req.method !== "POST") {
    res.writeHead(405).end("must POST");
    return;
  }

  let params = {};
  try {
    params = req.method === "POST" ? await readJsonBody(req) : Object.fromEntries(url.searchParams);
  } catch (err) {
    res.writeHead(400).end("bad json");
    return;
  }

  // For plan.execute, stream events via SSE-style chunked response.
  if (method === "plan.execute") {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const onEvent = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
    try {
      const result = await fn(params, { onEvent });
      res.write(`event: done\ndata: ${JSON.stringify(result)}\n\n`);
      res.end();
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
    return;
  }

  try {
    const result = await fn(params);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(result));
  } catch (err) {
    log.error("rpc failed", { method, error: err.message });
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export function startServer({ port = 0, openBrowser = true } = {}) {
  const token = generateSessionToken();

  const server = createServer(async (req, res) => {
    const host = req.headers.host || "";
    const url = new URL(req.url, `http://${host}`);

    if (url.pathname.startsWith("/rpc/")) {
      return handleRpc(req, res, host);
    }
    // Token-gated UI bootstrap.
    if (url.pathname === "/") {
      const t = url.searchParams.get("token");
      if (!verifySessionToken(t)) {
        res.writeHead(401, { "content-type": "text/html" });
        res.end(
          "<h1>archon-setup</h1><p>This URL needs a session token. Launch via <code>npx @archonvii/archon-setup</code> — the CLI will open the correct link.</p>"
        );
        return;
      }
    }
    return serveStatic(req, res, url.pathname);
  });

  return new Promise((resolveP) => {
    server.listen(port, "127.0.0.1", () => {
      const actualPort = server.address().port;
      const url = `http://127.0.0.1:${actualPort}/?token=${token}`;
      log.info("server started", { url: `http://127.0.0.1:${actualPort}/` });
      console.log(`\n  archon-setup ready: ${url}\n`);
      if (openBrowser) openInBrowser(url);
      resolveP({ server, port: actualPort, token, url });
    });
  });
}
