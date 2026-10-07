// Production Spotify extension and criteria; isolated storage/Spotify boundaries.
// Run: node scripts/tests/smart-playlist-rating.mjs [port]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixture = resolve(project, "scripts/tests/fixtures/smart-playlist-rating.ts");
const boundaries = /services\/(KeyboardShortcutService|storage\/StorageService|sync\/SyncLocalState|sync\/SyncInstallRecovery|sync\/SyncRuntime|SmartPlaylistSyncService)$|smart-playlists\/utils\/smartPlaylist.storage$|extensions\/WelcomeModal$/;
const result = await build({ entryPoints: [fixture], bundle: true, write: false, format: "iife", tsconfig: resolve(project, "tsconfig.json"),
  plugins: [{ name: "isolated-boundaries", setup(builder) {
    builder.onResolve({ filter: boundaries }, ({ path }) => ({ path, namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `export * from ${JSON.stringify(fixture)};`, resolveDir: project }));
  } }],
});
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Smart playlist rating test</title>
<style>:root{--spice-main:#121212;--spice-text:#fff;--spice-subtext:#aaa;--spice-button:#1ed760;--spice-tab-active:#333}body{background:#121212;color:#eee;font:15px system-ui;padding:24px}a{color:inherit}.main-trackList-trackListRow{display:flex!important;align-items:center;padding:18px;gap:36px;background:#242424;margin-top:8px}.main-trackList-rowSectionFirst{flex:1}.tagify-info{width:150px}button{font:inherit}pre{white-space:pre-wrap}</style>
<h1>Five-star favorites</h1><p>Production Tagify column • isolated example songs and Spotify membership</p><div class="main-trackList-indexable" role="grid"></div><pre id="status"></pre><script src="/bundle.js"></script></html>`;
const port = Number(process.argv[2] || 4323);
createServer((request, response) => {
  response.setHeader("content-type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
  response.end(request.url === "/bundle.js" ? result.outputFiles[0].text : html);
}).listen(port, "127.0.0.1", () => console.log(`http://127.0.0.1:${port}`));
