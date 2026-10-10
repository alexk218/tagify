// Production track-note previews with an isolated IndexedDB library and Spotify boundary.
// Run: node scripts/tests/track-notes.mjs [port] [entity-notes]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixture = process.argv[3] === "entity-notes" ? "entity-notes" : "track-notes";
// Rebuild on each page load so source edits show up after a browser refresh.
const bundle = () => build({ entryPoints: [resolve(project, `scripts/tests/fixtures/${fixture}.tsx`)], bundle: true, write: false, format: "iife", outfile: "bundle.js", tsconfig: resolve(project, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
});
let result = await bundle();
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tagify track notes verification</title><link rel="stylesheet" href="/bundle.css">
<style>:root{--spice-text:#fff;--spice-subtext:#b3b3b3;--spice-main:#121212;--spice-main-elevated:#242424;--spice-highlight:#1a1a1a;--spice-card:#282828;--spice-button:#1db954;--spice-button-active:#1ed760;--spice-button-disabled:#535353;--spice-tab-active:#333;--spice-misc:#7f7f7f;--spice-rgb-text:255,255,255}
*,*::before,*::after{box-sizing:border-box}body{background:#121212;color:#fff;font:14px -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;margin:0;padding:16px 24px}button,input,select{font-family:inherit}
#notification{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#4687d6;color:#fff;padding:10px 16px;border-radius:8px;font-weight:600;z-index:100000}#notification[data-error=true]{background:#e22134}
.fixtureBar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;margin:0 0 12px;padding:8px 12px;border:1px dashed #555;border-radius:8px;color:#aaa;font-size:12px}.fixtureBar button{background:#2a2a2a;color:#fff;border:1px solid #444;border-radius:6px;padding:4px 10px;cursor:pointer}</style>
<div id="app"></div><div id="notification" role="status" hidden></div><script src="/bundle.js"></script></html>`;
const port = Number(process.argv[2] || 4386);
createServer(async (request, response) => {
  const path = (request.url || "/").split("?")[0];
  if (path === "/") result = await bundle();
  const file = result.outputFiles.find((item) => path !== "/" && item.path.endsWith(path.slice(1)));
  response.setHeader("content-type", file ? (path.endsWith(".css") ? "text/css" : "text/javascript") : "text/html");
  response.end(file?.text ?? html);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
