// Isolated request-count fixture. Optional second argument compiles another checkout for comparison.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const source = process.argv[3] || project;
const result = await build({ entryPoints: [resolve(project, "scripts/tests/fixtures/request-safety.ts")], bundle: true, write: false, format: "iife", alias: { "@": resolve(source, "src") }, tsconfig: resolve(project, "tsconfig.json") });
createServer((req, res) => {
  res.setHeader("content-type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
  res.end(req.url === "/bundle.js" ? result.outputFiles[0].text : `<!doctype html><html><meta charset="utf-8"><title>Spotify request safety</title><style>body{background:#121212;color:white;font:16px system-ui;padding:32px}button{padding:12px;margin:6px}pre{white-space:pre-wrap}</style><h1>Spotify request safety</h1><p>Production services · simulated Spotify · no account access</p><button id="album-counts">Album count coordination</button><button id="accounting">Shared request accounting</button><button id="playlist-version">Unchanged playlist</button><button id="endpoints">Endpoint policy and error causes</button><button id="audio">Audio rate limit</button><button id="bulk">Cancel bulk selection</button><button id="cache">Reopen track details</button><button id="writes">Add 100 playlist songs</button><button id="foreground">Foreground priority</button><button id="stalled">Stalled request recovery</button><button id="uncertain">Uncertain write (10 seconds)</button><button id="refresh">Fresh playlist refresh</button><pre id="result">Ready</pre><script src="/bundle.js"></script></html>`);
}).listen(Number(process.argv[2] || 4390), "127.0.0.1", () => console.log(`http://127.0.0.1:${process.argv[2] || 4390}`));
