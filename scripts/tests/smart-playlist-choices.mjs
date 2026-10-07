// Production UI + IndexedDB + reconciliation, with an isolated Spotify boundary.
// Run: node scripts/tests/smart-playlist-choices.mjs [port]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const result = await build({ entryPoints: [resolve(project, "scripts/tests/fixtures/smart-playlist-choices.tsx")], bundle: true, write: false, format: "iife", outfile: "bundle.js", tsconfig: resolve(project, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
  banner: { js: 'globalThis.Spicetify = { Platform: { PlaylistAPI: {} }, showNotification: console.info };' },
});
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart playlist choices test</title><link rel="stylesheet" href="/bundle.css"><style>body{background:#121212;color:#eee;font:15px system-ui;padding:24px}button{font:inherit;margin-right:12px;padding:10px}pre{line-height:1.6}</style><h1>Smart playlist choices</h1><p>Isolated test library. Production UI, storage and sync; simulated Spotify membership.</p><button id="reset">Reset example</button><button id="reopen">Reopen Tagify</button><pre id="status"></pre><div id="app"></div><script src="/bundle.js"></script></html>`;
const port = Number(process.argv[2] || 4321);
createServer((request, response) => {
  const file = result.outputFiles.find((item) => item.path.endsWith(request.url?.slice(1) || "missing"));
  response.setHeader("content-type", file ? request.url.endsWith("css") ? "text/css" : "text/javascript" : "text/html");
  response.end(file?.text ?? html);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
