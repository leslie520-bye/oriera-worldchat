#!/usr/bin/env node
/* ============================================================
 * tools/proxy.mjs — optional helper, ZERO dependencies (node built-ins only).
 *
 * 1) Static server (same as `python -m http.server`):
 *      node tools/proxy.mjs --static .
 *
 * 2) Local relay for the Nebius Token Factory API. Only needed if your
 *    browser blocks the direct call with a CORS error (we could not verify
 *    Token Factory CORS without an API key, so this is the documented
 *    fallback). It forwards /tf/* to https://api.tokenfactory.nebius.com/*
 *    verbatim, headers included:
 *      node tools/proxy.mjs --relay 8787
 *    then in the demo's ⚙ Settings set Base URL to:
 *      http://127.0.0.1:8787/tf/v1
 *    The key still travels only between your browser and Nebius — the relay
 *    adds no logging and stores nothing.
 * ============================================================ */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const args = process.argv.slice(2);
const UPSTREAM = "https://api.tokenfactory.nebius.com";
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
};

const isStatic = args[0] === "--static";
const isRelay = args[0] === "--relay";
const root = process.cwd();
const port = Number(process.env.PORT || (isStatic ? (args[2] || 8000) : isRelay ? (args[1] || 8787) : 8000));

if (isStatic) {
  const dir = args[1] ? join(process.cwd(), args[1]) : process.cwd();
  createServer(async (req, res) => {
    try {
      const rawPath = req.url.split("?")[0];
      let p = normalize(decodeURIComponent(rawPath)); // win32: normalize("/") == "\\"
      if (rawPath.endsWith("/")) { res.writeHead(302, { Location: "/index.html" }); res.end(); return; }
      const file = join(dir, p);
      const s = await stat(file);
      const data = await readFile(s.isDirectory() ? join(file, "index.html") : file);
      res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch {
      res.writeHead(404); res.end("not found");
    }
  }).listen(port, "127.0.0.1", () => console.log(`static server → http://127.0.0.1:${port}/`));
} else {
  createServer(async (req, res) => {
    if (!req.url.startsWith("/tf/")) { res.writeHead(404); res.end(); return; }
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const upstream = await fetch(UPSTREAM + req.url.slice(3), {
        method: req.method,
        headers: Object.fromEntries(Object.entries(req.headers).filter(([h]) => !["host", "origin", "referer", "content-length"].includes(h))),
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      });
      res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (e) {
      res.writeHead(502); res.end("relay error: " + e.message);
    }
  }).listen(port, "127.0.0.1", () =>
    console.log(`token factory relay → http://127.0.0.1:${port}/tf/v1  (upstream ${UPSTREAM})`));
}
