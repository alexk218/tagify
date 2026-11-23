// Isolated "Share your ratings" question, publish invitation, sharing window and update notice.
// Run: node scripts/tests/rating-sharing.mjs [port] (?view=question|publish-prompt|share-dialog|notice, ?sheet=narrow, ?save=paused)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const bundle = () => build({ entryPoints: [resolve(project, "scripts/tests/fixtures/rating-sharing.tsx")], bundle: true, write: false, format: "iife", outfile: "bundle.js", tsconfig: resolve(project, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
});
let result = await bundle();
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tagify rating sharing verification</title><link rel="stylesheet" href="/bundle.css">
<style>:root{--spice-text:#fff;--spice-subtext:#b3b3b3;--spice-main:#121212;--spice-main-elevated:#242424;--spice-highlight:#1a1a1a;--spice-card:#282828;--spice-button:#1db954;--spice-button-active:#1ed760;--spice-button-disabled:#535353;--spice-tab-active:#333;--spice-misc:#7f7f7f;--spice-rgb-text:255,255,255}
*,*::before,*::after{box-sizing:border-box}body{background:#3a3a3a;color:#fff;font:14px -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;margin:0;padding:24px}button,input,select{font-family:inherit}</style>
<div id="app"></div><script src="/bundle.js"></script></html>`;
const port = Number(process.argv[2] || 4418);
createServer(async (request, response) => {
  const path = (request.url || "/").split("?")[0];
  if (path === "/") result = await bundle();
  const file = result.outputFiles.find((item) => path !== "/" && item.path.endsWith(path.slice(1)));
  response.setHeader("content-type", file ? (path.endsWith(".css") ? "text/css" : "text/javascript") : "text/html");
  response.end(file?.text ?? html);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
