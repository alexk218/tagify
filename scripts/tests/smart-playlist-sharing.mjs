// Production sharing UI and IndexedDB with an isolated Spotify boundary.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const result = await build({ entryPoints: [resolve(project, "scripts/tests/fixtures/smart-playlist-sharing.tsx")], bundle: true, write: false, format: "iife", outfile: "bundle.js", tsconfig: resolve(project, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
  banner: { js: 'globalThis.Spicetify = { Platform: { username: "sharing-fixture", PlaylistAPI: {}, History: {push: console.info} }, showNotification: console.info };' },
});
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart playlist sharing</title><link rel="stylesheet" href="/bundle.css"><style>:root{--spice-main:#121212;--spice-card:#202020;--spice-text:#fff;--spice-subtext:#b3b3b3;--spice-button:#1ed760;--spice-button-disabled:#444}body{background:#121212;color:#eee;font:14px system-ui;padding:24px}button,input,select{font:inherit}pre{white-space:pre-wrap}</style><div id="app"></div><script src="/bundle.js"></script></html>`;
const port = Number(process.argv[2] || 4333);
createServer((request, response) => {
  const file = result.outputFiles.find((item) => item.path.endsWith(request.url?.slice(1) || "missing"));
  response.setHeader("content-type", file ? request.url.endsWith("css") ? "text/css" : "text/javascript" : "text/html");
  response.end(file?.text ?? html);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
