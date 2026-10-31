#!/usr/bin/env node
const { spawn } = require("child_process");
const { mkdtempSync, rmSync } = require("fs");
const { tmpdir } = require("os");
const { dirname, join } = require("path");

// spicetify-creator writes its entry file to <tmpdir>/spicetify-creator/index.jsx,
// one path shared by every checkout. A build in one worktree then overwrites the
// entry another worktree's build or watch is bundling, and that watch rebuilds
// from the other checkout's source. Each run gets its own temporary directory.
function isolatedEnvironment(directory, env = process.env) {
  return { ...env, TMPDIR: directory, TMP: directory, TEMP: directory };
}

// The calling package's own copy first (Pro has one), then Secret's, so the
// script also works from the repository root.
function creatorBin(cwd = process.cwd()) {
  const manifest = require.resolve("spicetify-creator/package.json", { paths: [cwd, __dirname] });
  return join(dirname(manifest), require(manifest).bin);
}

function main(args = process.argv.slice(2)) {
  const directory = mkdtempSync(join(tmpdir(), "tagify-build-"));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  const child = spawn(process.execPath, [creatorBin(), ...args], {
    stdio: "inherit",
    env: isolatedEnvironment(directory),
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (error) => {
    cleanup();
    console.error(error);
    process.exit(1);
  });
  child.on("exit", (code, signal) => {
    cleanup();
    process.exit(code ?? (signal ? 1 : 0));
  });
}

if (require.main === module) main();

module.exports = { isolatedEnvironment, creatorBin };
