// The track list's "Tagged by others" view and the "N others" sharing gate, served for a browser.
// Production UI and request code with simulated Liked Songs and a faked Community; nothing leaves the page.
// Run: node scripts/tests/track-list-tagged-by-others.mjs [port]
//      then open /?view=others (locked), /?view=others&shared=1 (unlocked), /?view=tagged (sharing gate on "N others"), /?off=1 (switches off)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
// Rebuild on each page load so source edits show up after a browser refresh.
const bundle = () => build({ entryPoints: [resolve(project, "scripts/tests/fixtures/track-list-tagged-by-others.tsx")], bundle: true, write: false, format: "iife", outfile: "bundle.js", tsconfig: resolve(project, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
});
let result = await bundle();
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tagged by others in the track list</title><link rel="stylesheet" href="/bundle.css">
<style>:root{--spice-text:#fff;--spice-subtext:#b3b3b3;--spice-main:#121212;--spice-main-elevated:#242424;--spice-highlight:#1a1a1a;--spice-card:#282828;--spice-button:#1db954;--spice-button-active:#1ed760;--spice-button-disabled:#535353;--spice-tab-active:#333;--spice-misc:#7f7f7f;--spice-rgb-text:255,255,255}
*,*::before,*::after{box-sizing:border-box}body{background:#121212;color:#fff;font:14px -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;margin:0}button,input,select{font-family:inherit}</style>
<div id="app"></div><script src="/bundle.js"></script></html>`;
const port = Number(process.argv[2] || 4431);
createServer(async (request, response) => {
  const path = (request.url || "/").split("?")[0];
  if (path === "/") result = await bundle();
  const file = result.outputFiles.find((item) => path !== "/" && item.path.endsWith(path.slice(1)));
  response.setHeader("content-type", file ? (path.endsWith(".css") ? "text/css" : "text/javascript") : "text/html");
  response.end(file?.text ?? html);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
