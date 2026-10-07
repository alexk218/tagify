// Production extension; isolated example library and Spotify APIs.
// Run: node scripts/tests/spotify-layout.mjs [port]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixture = resolve(project, "scripts/tests/fixtures/spotify-layout.ts");
const boundaries = /services\/(KeyboardShortcutService|storage\/StorageService|sync\/SyncLocalState|sync\/SyncInstallRecovery|sync\/SyncRuntime|SmartPlaylistSyncService)$|smart-playlists\/utils\/smartPlaylist.storage$|extensions\/WelcomeModal$/;

const result = await build({
  entryPoints: [fixture], bundle: true, write: false, format: "iife",
  tsconfig: resolve(project, "tsconfig.json"),
  plugins: [{ name: "isolated-boundaries", setup(builder) {
    builder.onResolve({ filter: boundaries }, ({ path }) => ({ path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export * from ${JSON.stringify(fixture)};`, resolveDir: project }));
  } }],
});
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Spotify layout compatibility</title>
<style>:root{--spice-main:#121212;--spice-text:#fff;--spice-subtext:#aaa;--spice-button:#1ed760;--spice-tab-active:#333}body{background:#121212;color:#eee;font:15px system-ui;padding:24px}a{color:inherit;text-decoration:none}button{font:inherit;cursor:pointer}nav{display:flex;gap:16px;margin-bottom:24px}[role="row"]{padding:12px 16px;background:#242424;margin-top:8px}[role="row"],[role="row"]>[role="presentation"]{align-items:center;gap:16px}[role="columnheader"]{color:#aaa}footer{margin-top:36px;padding:20px;background:#242424}[data-testid="now-playing-widget"]{display:flex;align-items:center;gap:12px}pre{white-space:pre-wrap}#status{font-size:12px;color:#aaa}</style>
<h1>Rated tracks</h1><p>Example library using the production Tagify extension</p>
<nav><a href="?layout=modern">Spotify 1.3.3</a><a href="?layout=aliased">Spotify 1.3.3 with theme aliases</a><a href="?layout=legacy">Older Spotify</a></nav>
<button id="rerender">Recreate Spotify layout</button> <button id="next">Next song</button> <button id="toggle">Toggle ratings</button> <button id="mount">Mount player</button>
<main id="main-view"></main><footer></footer><pre id="status"></pre><script src="/bundle.js"></script></html>`;
const port = Number(process.argv[2] || 4327);
createServer((request, response) => {
  response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? result.outputFiles[0].text : html);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}?layout=modern`));
