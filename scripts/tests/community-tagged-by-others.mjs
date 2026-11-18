// The Community view's "Your songs, tagged by others" card and the first-run card's "See all" line:
// production UI, scan and request code, with simulated Liked Songs and playlists and a faked
// Community answer. No request leaves the page.
// Run: node scripts/tests/community-tagged-by-others.mjs [screenshot folder]
//      node scripts/tests/community-tagged-by-others.mjs --serve [port]   (then open /?scene=results)
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import process from "node:process";

const require = createRequire(import.meta.url);
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const project = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const result = await build({ entryPoints: [resolve(project, "scripts/tests/fixtures/community-tagged-by-others.tsx")], bundle: true, write: false, format: "iife", outfile: "bundle.js", tsconfig: resolve(project, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"development"' },
});
const html = `<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tagged by others verification</title><link rel="stylesheet" href="/bundle.css">
<style>:root{--spice-text:#fff;--spice-subtext:#b3b3b3;--spice-main:#121212;--spice-main-elevated:#242424;--spice-highlight:#1a1a1a;--spice-card:#282828;--spice-button:#1db954;--spice-button-active:#1ed760;--spice-button-disabled:#535353;--spice-tab-active:#333;--spice-misc:#7f7f7f;--spice-rgb-text:255,255,255;--spice-notification-error:#f15e6c}
*,*::before,*::after{box-sizing:border-box}body{background:#121212;color:#fff;font:14px -apple-system,BlinkMacSystemFont,"Helvetica Neue",Arial,sans-serif;margin:0}button,input,select{font-family:inherit}</style>
<div id="app"></div><script src="/bundle.js"></script></html>`;
const server = createServer((request, response) => {
  const path = (request.url || "/").split("?")[0];
  const file = result.outputFiles.find((item) => path !== "/" && item.path.endsWith(path.slice(1)));
  response.setHeader("content-type", file ? (path.endsWith(".css") ? "text/css" : "text/javascript") : "text/html");
  response.end(file?.text ?? html);
});
const serveOnly = process.argv[2] === "--serve";
const port = serveOnly ? Number(process.argv[3] || 4407) : 0;
await new Promise((done) => server.listen(port, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
if (serveOnly) {
  console.log(`${origin}/?scene=results`);
} else {
  // Community's Playwright when it is installed, otherwise one on this machine.
  const playwright = (() => {
    for (const load of [
      () => createRequire(new URL("../../../tagify-community/package.json", import.meta.url))("@playwright/test"),
      () => require("playwright"),
      () => createRequire(`${process.env.NODE_PATH || "/usr/local/lib/node_modules"}/`)("playwright"),
    ]) { try { return load(); } catch { /* Try the next one. */ } }
    throw new Error("Playwright isn't installed. Install the Community workspace, or run with --serve and open the page yourself.");
  })();
  const evidence = resolve(process.argv[2] || resolve(project, "node_modules/.cache/community-tagged-by-others"));
  await mkdir(evidence, { recursive: true });
  const browser = await playwright.chromium.launch();
  const COVERS = ["#3d5a80", "#9b5de5", "#e07a5f", "#2a9d8f", "#e9c46a", "#577590"];
  const open = async (scene, viewport = { width: 1100, height: 900 }) => {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    // Only the fixture's own page loads; covers are drawn here and nothing else leaves the browser.
    await context.route((url) => url.origin !== origin, (route) => {
      const cover = route.request().url().match(/^https:\/\/i\.scdn\.co\/image\/fixture-(\d)$/);
      return cover
        ? route.fulfill({ contentType: "image/svg+xml", body: `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="${COVERS[Number(cover[1])]}"/></svg>` })
        : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|net::ERR_FAILED/.test(message.text())) errors.push(message.text()); });
    await page.goto(`${origin}/?scene=${scene}`);
    return { page, errors, close: () => context.close() };
  };
  const shot = (page, name) => page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true });
  const existingCard = (page) => page.locator("section[aria-labelledby='community-title'] > div");
  const card = (page) => page.locator("section[aria-labelledby='tagged-by-others-title']");
  // 1,230 Liked Songs once a duplicate and a local file are left out; playlists hold 340 more.
  const DONE = /Checked your 1,230 Liked Songs · \d+ found/;
  // A check saved before Liked Songs-only checks, and one that went on into the three playlists worth reading.
  const DONE_WITH_PLAYLISTS = /Checked 1,570 songs · \d+ found/;
  const DONE_PLAYLISTS = /Checked 1,570 songs from your Liked Songs and 3 playlists · \d+ found/;
  const NOTHING_READ = { spotifyReads: 0, rootlistReads: 0, playlistReads: 0, communityRequests: 0, communityBodies: [] };
  const counts = (page) => page.evaluate(() => window.fixtureCounts());

  try {
    // The existing card, without and with the new one below it.
    const before = await open("before");
    await before.page.getByRole("heading", { name: "Your tags are public" }).waitFor();
    assert.equal(await card(before.page).count(), 0);
    await shot(before.page, "existing-card-before");
    const beforeCard = await existingCard(before.page).screenshot();
    const beforeBox = await existingCard(before.page).boundingBox();
    assert.deepEqual(before.errors, []);
    await before.close();

    const results = await open("results");
    await results.page.getByText(DONE).waitFor();
    assert.deepEqual(await existingCard(results.page).boundingBox(), beforeBox, "the existing card moved");
    assert.ok(beforeCard.equals(await existingCard(results.page).screenshot()), "the existing card changed");
    await shot(results.page, "existing-card-after");
    // Liked Songs only: 500 + 500 + 230, its pages read once, and neither the playlist list nor a playlist.
    const sent = await counts(results.page);
    assert.deepEqual(sent.communityBodies.map((body) => body.songs), [500, 500, 230]);
    // Three Liked Songs pages of 500.
    assert.equal(sent.spotifyReads, 3);
    assert.equal(sent.rootlistReads, 0);
    assert.equal(sent.playlistReads, 0);
    // Check again comes back ten minutes after a check; until then only when it was made shows.
    await results.page.getByText("Checked just now").waitFor();
    assert.equal(await card(results.page).getByRole("button", { name: "Check again" }).count(), 0);
    assert.ok(sent.communityBodies.every((body) => body.authorization === "Bearer fixture-token" && body.deviceId));
    assert.equal(await card(results.page).getByRole("listitem").count(), 50);
    // The member already has Chill on the first song.
    await assert.doesNotReject(card(results.page).getByRole("button", { name: "Chill added to Midnight City" }).waitFor());
    await card(results.page).screenshot({ path: resolve(evidence, "results.png") });
    await results.page.getByRole("button", { name: "Add Late night to Open Eye Signal" }).click();
    await results.page.getByRole("button", { name: "Late night added to Open Eye Signal" }).waitFor();
    await results.page.getByRole("button", { name: "Show more" }).click();
    assert.equal(await card(results.page).getByRole("listitem").count(), 100);
    assert.equal(await results.page.getByLabel("Fixture log").textContent(), JSON.stringify(["Open Eye Signal: Late night"]));
    await card(results.page).screenshot({ path: resolve(evidence, "results-tag-added.png") });
    // Search, sort and opening a song.
    await results.page.getByRole("combobox", { name: "Sort songs" }).selectOption("recent");
    assert.match(await card(results.page).getByRole("listitem").first().textContent(), /Midnight City/);
    await results.page.getByRole("searchbox", { name: "Search songs or artists" }).fill("only in a playlist");
    await results.page.getByText(/No songs match/).waitFor();
    await results.page.getByRole("searchbox", { name: "Search songs or artists" }).fill("jon hopkins");
    await shot(results.page, "search");
    await results.page.getByRole("button", { name: "Open Open Eye Signal" }).click();
    assert.match(await results.page.getByLabel("Fixture log").textContent(), /open Open Eye Signal/);
    await results.page.getByRole("searchbox", { name: "Search songs or artists" }).fill("no such song anywhere");
    await results.page.getByText(/No songs match/).waitFor();
    assert.equal(await card(results.page).getByRole("listitem").count(), 0);
    await shot(results.page, "search-no-matches");
    assert.deepEqual(results.errors, []);
    await results.close();

    const checking = await open("checking");
    await checking.page.getByText("Checked 500 of your Liked Songs · 67 found").waitFor();
    await checking.page.getByText("Checking your Liked Songs…").waitFor();
    await shot(checking.page, "checking");
    assert.deepEqual(checking.errors, []);
    await checking.close();

    const none = await open("none");
    await none.page.getByText("No other members have tagged your Liked Songs yet.").waitFor();
    await shot(none.page, "none-found");
    await none.close();

    const guest = await open("not-connected");
    await guest.page.getByRole("button", { name: "Connect to see them" }).click();
    assert.equal(await guest.page.getByLabel("Fixture log").textContent(), JSON.stringify(["connect from the list"]));
    await guest.page.getByText(/see which of your Liked Songs other members already tagged/).waitFor();
    assert.deepEqual(await counts(guest.page), NOTHING_READ);
    await shot(guest.page, "not-connected");
    await guest.close();

    const narrow = await open("results", { width: 420, height: 900 });
    await narrow.page.getByText(DONE).waitFor();
    assert.ok(await narrow.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "the narrow layout scrolls sideways");
    await narrow.page.screenshot({ path: resolve(evidence, "narrow.png") });
    await narrow.close();

    const stopped = await open("spotify-stopped");
    await stopped.page.getByText(/Spotify needs a break/).waitFor();
    // The first page of 500 holds one duplicate and one local file.
    await stopped.page.getByText(/Checked 498 of your Liked Songs · \d+ found/).waitFor();
    // Page 0, then the page Spotify refused: nothing after it.
    assert.equal((await counts(stopped.page)).spotifyReads, 2);
    await shot(stopped.page, "spotify-stopped");
    await stopped.close();

    for (const [scene, copy] of [
      ["unreachable", "Tagify couldn't reach Community just now."],
      ["paused", "Community has paused this for now. Check back a little later."],
      // A Community from before the lookup answers 404.
      ["not-available", "This isn't available just yet. Check back soon."],
    ]) {
      const view = await open(scene);
      await view.page.getByText(copy, { exact: false }).waitFor();
      // The first request was the last: nothing is asked again after Community couldn't answer.
      assert.ok((await counts(view.page)).communityRequests <= 2);
      await shot(view.page, scene);
      await view.close();
    }

    // Community stops answering after two requests: what it found stays.
    const limited = await open("limited");
    await limited.page.getByText(/Community has checked as many songs as it can for now/).waitFor();
    await limited.page.getByText(/Checked 1,000 of your Liked Songs · \d+ found/).waitFor();
    assert.ok((await counts(limited.page)).communityRequests <= 4);
    await shot(limited.page, "limited");
    await limited.close();

    // A check kept on this computer shows at once, without reading Spotify or asking Community. It
    // was saved before checks read Liked Songs only, so it still counts songs.
    const saved = await open("saved");
    await saved.page.getByText(/Checked 3 hours ago/).waitFor();
    await saved.page.getByText(DONE_WITH_PLAYLISTS).waitFor();
    assert.equal(await card(saved.page).getByRole("listitem").count(), 8);
    assert.deepEqual(await counts(saved.page), NOTHING_READ);
    await shot(saved.page, "saved-results");
    // Check again reads Liked Songs only.
    await saved.page.getByRole("button", { name: "Check again" }).click();
    await saved.page.getByText(DONE).waitFor();
    await saved.page.getByText(/Checked just now/).waitFor();
    assert.equal((await counts(saved.page)).communityRequests, 3);
    assert.equal(await card(saved.page).getByRole("button", { name: "Check again" }).count(), 0);
    assert.equal((await counts(saved.page)).playlistReads, 0);
    await saved.page.screenshot({ path: resolve(evidence, "check-again.png") });
    // Reloading shows the new check from this computer, again without a read.
    await saved.page.goto(`${origin}/?scene=results-kept`);
    await saved.page.getByText(DONE).waitFor();
    assert.deepEqual(await counts(saved.page), NOTHING_READ);
    assert.deepEqual(saved.errors, []);
    await saved.close();

    // "Also check playlists I made…" after the Liked Songs check opens a picker of the member's own
    // playlists. "Liked again" repeats Liked Songs and adds nothing; "Road trip" adds 300 songs;
    // "Mixed" shares 60 with Liked Songs and 50 with "Road trip", and adds 40. The followed "Sam's
    // mix", Spotify's "Daily Mix 1" and the empty playlist are never listed or read, and Liked Songs
    // isn't read again.
    const withPlaylists = await open("playlists");
    await withPlaylists.page.getByText(DONE).waitFor();
    const likedReads = (await counts(withPlaylists.page)).spotifyReads;
    await shot(withPlaylists.page, "playlists-offer");
    await withPlaylists.page.getByRole("button", { name: "Also check playlists I made…" }).click();
    const picker = withPlaylists.page.getByRole("dialog", { name: "Choose playlists to check" });
    await picker.getByText("Road trip").waitFor();
    for (const never of ["Sam's mix", "Daily Mix 1", "Empty"]) assert.equal(await picker.getByText(never, { exact: true }).count(), 0);
    await picker.getByRole("button", { name: "Select all my playlists" }).click();
    await shot(withPlaylists.page, "playlist-picker");
    await picker.getByRole("button", { name: "Check 3 playlists" }).click();
    await withPlaylists.page.getByText(DONE_PLAYLISTS).waitFor();
    const afterPlaylists = await counts(withPlaylists.page);
    assert.deepEqual(afterPlaylists.communityBodies.map((body) => body.songs), [500, 500, 230, 300, 40]);
    // One playlist-list read for the picker, reused by the check, and one Liked Songs size read beside it.
    assert.equal(afterPlaylists.rootlistReads, 1);
    assert.equal(afterPlaylists.spotifyReads, likedReads + 1);
    assert.deepEqual((await withPlaylists.page.evaluate(() => window.fixturePlaylistsRead())).sort(), ["1".repeat(22), "2".repeat(22), "3".repeat(22)]);
    // Every chosen playlist was read: only choosing more is offered.
    assert.equal(await card(withPlaylists.page).getByRole("button", { name: /remaining/ }).count(), 0);
    assert.equal(await card(withPlaylists.page).getByRole("button", { name: "Choose playlists…" }).count(), 1);
    await withPlaylists.page.getByRole("searchbox", { name: "Search songs or artists" }).fill("only in a playlist");
    assert.equal(await card(withPlaylists.page).getByRole("listitem").count(), 1);
    await shot(withPlaylists.page, "playlists-done");
    assert.deepEqual(withPlaylists.errors, []);
    await withPlaylists.close();

    // Closing and reopening Community mid-check shows the same check; Spotify isn't read from the top again.
    const reopen = await open("reopen");
    await reopen.page.getByText("Checked 500 of your Liked Songs · 67 found").waitFor();
    // The check reads all 3 Liked Songs pages while Community's answers wait; a restart would read from the top again.
    await reopen.page.waitForFunction(() => window.fixtureCounts().spotifyReads === 3);
    const readsBefore = (await counts(reopen.page)).spotifyReads;
    for (const label of ["Close Community", "Open Community", "Close Community", "Open Community"]) await reopen.page.getByRole("button", { name: label }).click();
    await reopen.page.getByText("Checked 500 of your Liked Songs · 67 found").waitFor();
    await reopen.page.waitForTimeout(500);
    assert.equal((await counts(reopen.page)).spotifyReads, readsBefore);
    assert.deepEqual(reopen.errors, []);
    await reopen.close();

    // Spotify reloading part way through: what was found shows at once, and the check continues
    // from the songs already checked, asking Community only about the rest.
    const reload = await open("slow");
    await reload.page.getByText("Checked 500 of your Liked Songs · 67 found").waitFor();
    await reload.page.goto(`${origin}/?scene=results-kept`);
    await reload.page.getByText(/Checked (500|1,000) of your Liked Songs/).waitFor({ timeout: 1_000 });
    await reload.page.getByText(DONE).waitFor();
    assert.deepEqual((await counts(reload.page)).communityBodies.map((body) => body.songs), [500, 230]);
    assert.deepEqual(reload.errors, []);
    await reload.close();

    // A check from yesterday stays on screen while a new one runs quietly behind it, then is replaced.
    const stale = await open("stale");
    await stale.page.getByText("Checking for new tags…").waitFor();
    assert.equal(await card(stale.page).getByRole("listitem").count(), 8);
    await stale.page.getByText("Checked your 1,230 Liked Songs · 8 found").waitFor();
    await shot(stale.page, "quiet-refresh");
    await stale.page.getByText(/Checked just now/).waitFor();
    await stale.page.getByText(DONE).waitFor();
    assert.equal(await stale.page.getByText("Checking for new tags…").count(), 0);
    assert.deepEqual(stale.errors, []);
    await stale.close();

    // The read limit stops the check with what it found.
    const limit = await open("allowance");
    await limit.page.getByText(/Tagify takes a break after reading a lot for this list/).waitFor();
    // One page holds 500 songs, one of them a duplicate and one a local file.
    await limit.page.getByText(/Checked 498 of your Liked Songs · \d+ found/).waitFor();
    assert.equal((await counts(limit.page)).spotifyReads, 1);
    assert.equal(await card(limit.page).getByRole("button", { name: "Also check playlists I made…" }).count(), 0);
    await shot(limit.page, "allowance");
    await limit.close();

    // One playlist Spotify can't open is passed over; the rest is checked.
    const skipped = await open("skipped-playlist");
    await skipped.page.getByText(DONE).waitFor();
    await skipped.page.getByRole("button", { name: "Also check playlists I made…" }).click();
    await skipped.page.getByRole("dialog").getByRole("button", { name: "Select all my playlists" }).click();
    await skipped.page.getByRole("dialog").getByRole("button", { name: /^Check \d+ playlists?$/ }).click();
    await skipped.page.getByText(/couldn't open 1 playlist/).waitFor();
    await skipped.page.getByText(/Checked 1,320 songs from your Liked Songs and 3 playlists · \d+ found/).waitFor();
    await shot(skipped.page, "skipped-playlist");
    await skipped.close();

    const cap = await open("cap");
    await cap.page.getByText(/You have more Liked Songs than Tagify checks at once/).waitFor();
    await cap.page.getByText(/Checked your 1,000 Liked Songs · \d+ found/).waitFor();
    await shot(cap.page, "cap");
    await cap.close();

    // The first-run card, without and with its "See all" line.
    const firstBefore = await open("first-run-before", { width: 900, height: 700 });
    await firstBefore.page.getByText(/Members already tagged \d of your songs/).waitFor();
    assert.equal(await firstBefore.page.getByRole("button", { name: "See all" }).count(), 0);
    await shot(firstBefore.page, "first-run-before");
    await firstBefore.close();
    const firstAfter = await open("first-run", { width: 900, height: 700 });
    await firstAfter.page.getByText(/Members already tagged \d of your songs/).waitFor();
    await shot(firstAfter.page, "first-run-after");
    await firstAfter.page.getByRole("button", { name: "See all" }).click();
    assert.equal(await firstAfter.page.getByLabel("Fixture log").textContent(), JSON.stringify(["see all"]));
    assert.deepEqual(firstAfter.errors, []);
    await firstAfter.close();

    const reconnect = await open("reconnect");
    await reconnect.page.getByRole("button", { name: "Reconnect device" }).waitFor();
    assert.equal(await card(reconnect.page).count(), 0);
    assert.deepEqual(await counts(reconnect.page), NOTHING_READ);
    await reconnect.close();
    console.log(`Tagged by others: all checks passed. Screenshots in ${evidence}`);
  } finally {
    await browser.close();
    server.close();
  }
}
