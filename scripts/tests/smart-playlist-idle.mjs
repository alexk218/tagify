// Browser reproduction using the production scheduler, reconciliation and criteria
// logic, with isolated in-memory Spotify/storage boundaries. No user data is used.
// Run: node scripts/tests/smart-playlist-idle.mjs [port]
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const require = createRequire(import.meta.url);
const testRequire = createRequire(require.resolve("vitest"));
const { build } = createRequire(testRequire.resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const fixture = resolve(project, "scripts/tests/fixtures/smart-playlist-idle.ts");
const boundaries = new Set([
  "@/services/storage/StorageService",
  "@/services/storage/IndexedDBStorageService",
  "@/services/SpotifyApiService",
  "@/services/SpotifyService",
  "@/services/sync/SyncLocalState",
  "@/features/tag-data",
]);
const result = await build({
  entryPoints: [fixture], bundle: true, write: false, format: "iife",
  tsconfig: resolve(project, "tsconfig.json"),
  plugins: [{ name: "isolated-boundaries", setup(builder) {
    builder.onResolve({ filter: /^@\// }, ({ path }) => boundaries.has(path)
      ? { path, namespace: "fixture" } : undefined);
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      contents: `export { storageService, indexedDBStorage, spotifyApiService, spotifyService,
        flushLocalPersistence, isLocalPersistencePaused, normalizeSmartPlaylistCriteriaList }
        from ${JSON.stringify(fixture)};`, resolveDir: project,
    }));
  } }],
});
const html = `<!doctype html><html><meta charset="utf-8"><title>Tagify background CPU reproduction</title>
<style>body{font:16px system-ui;background:#121212;color:#eee;padding:32px}button{padding:12px;margin:8px}pre{white-space:pre-wrap}</style>
<h1>Tagify idle reconciliation</h1><p>Production sync service • isolated Spotify/storage fixtures • 10,000 tracks • 24 Smart Playlists</p>
<button id="hidden">Run 32 seconds hidden</button><button id="visible">Run 32 seconds visible</button>
<pre id="output">Ready. Hidden mode simulates document.visibilityState without modifying Spotify.</pre>
<script src="/bundle.js"></script></html>`;
let latest = null;
createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/results") {
    let data = "";
    for await (const chunk of request) data += chunk;
    latest = JSON.parse(data);
    console.log(JSON.stringify(latest));
    response.end("ok");
  } else if (request.url === "/results") {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(latest));
  } else if (request.url === "/bundle.js") {
    response.setHeader("content-type", "text/javascript");
    response.end(result.outputFiles[0].text);
  } else {
    response.setHeader("content-type", "text/html"); response.end(html);
  }
}).listen(Number(process.argv[2] || 4319), "127.0.0.1", () => console.log(`http://127.0.0.1:${process.argv[2] || 4319}`));
