import { afterEach, describe, expect, it } from "vitest";
import {
  buildSpotifyColumnTemplate,
  buildTagifyGridTemplate,
  getRowItemUri,
  getSpotifyPlayerAnchor,
  getSpotifyRowLayout,
  getSpotifyTracklistHeader,
  getSpotifyTracklists,
  getSpotifyTrackRows,
  getTagifyColumnWidth,
  insertSpotifyColumn,
  parseGridTracks,
  planTagifyColumn,
} from "../spotifyLayout";

afterEach(() => document.body.replaceChildren());

function tracklist(layout) {
  const legacy = layout === "legacy";
  const aliased = layout === "aliased";
  const cells = (header) => [1, 2, 3, 4].map((index) =>
    `<div role="${header ? "columnheader" : "gridcell"}" aria-colindex="${index}" class="${legacy && index === 4 ? "main-trackList-rowSectionEnd" : "hashedCell"}">${index}</div>`,
  ).join("");
  document.body.innerHTML = `<main id="main-view"><div role="grid" class="${legacy ? "main-trackList-indexable" : "hashedGrid"}">
    <div role="row" class="${legacy || aliased ? "main-trackList-trackListHeaderRow" : "hashedHeader"}">${cells(true)}</div>
    <div role="presentation"><div role="row" class="${legacy || aliased ? "main-trackList-trackListRow" : "hashedRow"}" style="transform:translateY(40px)">
      ${legacy ? cells(false) : `<div role="presentation" style="display:grid;min-height:36px;grid-template-columns:16px 3fr 2fr 1fr !important">${cells(false)}</div>`}
    </div></div>
  </div></main>`;
  return getSpotifyTracklists()[0];
}

function layoutColumnIndexReset(row) {
  const cells = row.querySelectorAll('[aria-colindex]');
  cells[cells.length - 1].setAttribute("aria-colindex", "4");
}

describe("Spotify tracklist layouts", () => {
  it.each(["legacy", "modern", "aliased"])("finds and enhances %s rows without changing other Spotify styles", (mode) => {
    const grid = tracklist(mode);
    expect(getSpotifyTracklists()).toEqual([grid]);
    expect(getSpotifyTracklistHeader(grid)).not.toBeNull();
    const [row] = getSpotifyTrackRows(grid);
    const layout = getSpotifyRowLayout(row);
    const previousStyle = layout.container.style.cssText;
    const column = document.createElement("div");
    column.className = "tagify-info";
    const restore = insertSpotifyColumn(layout, column, "16px 3fr 2fr 150px 1fr");

    expect(column.parentElement).toBe(layout.container);
    expect(column.nextElementSibling).toBe(layout.lastColumn);
    expect(column.getAttribute("aria-colindex")).toBe("4");
    expect(layout.lastColumn.getAttribute("aria-colindex")).toBe("5");
    expect(row.style.transform).toBe("translateY(40px)");
    if (mode !== "legacy") expect(layout.container.style.minHeight).toBe("36px");

    restore();
    expect(column.isConnected).toBe(false);
    expect(layout.lastColumn.getAttribute("aria-colindex")).toBe("4");
    expect(layout.container.style.cssText).toBe(previousStyle);
  });

  it("keeps the row's template when a stale cell is restored after a newer one was added", () => {
    const grid = tracklist("modern");
    const [row] = getSpotifyTrackRows(grid);
    const first = document.createElement("div");
    const restoreFirst = insertSpotifyColumn(getSpotifyRowLayout(row), first, "16px 3fr 2fr 150px 1fr");
    // Spotify drops the cell; Tagify adds a fresh one to the same row.
    first.remove();
    layoutColumnIndexReset(row);
    const layout = getSpotifyRowLayout(row);
    const second = document.createElement("div");
    insertSpotifyColumn(layout, second, "16px 3fr 2fr 150px 1fr");

    restoreFirst();

    expect(second.isConnected).toBe(true);
    expect(layout.container.style.getPropertyValue("grid-template-columns")).toBe("16px 3fr 2fr 150px 1fr");
    expect(layout.lastColumn.getAttribute("aria-colindex")).toBe("5");
  });

  it("does not enhance unrelated grids outside Spotify's tracklist surfaces", () => {
    tracklist("modern");
    const other = document.createElement("div");
    other.innerHTML = '<div role="grid"><div role="row"><div role="gridcell" aria-colindex="1"></div><div role="gridcell" aria-colindex="2"></div></div></div>';
    document.body.append(other);
    expect(getSpotifyTracklists()).toHaveLength(1);
  });

  it("processes an inner grid once when a legacy wrapper is also present", () => {
    const grid = tracklist("modern");
    const wrapper = document.createElement("div");
    wrapper.className = "main-trackList-indexable";
    grid.before(wrapper);
    wrapper.append(grid);
    expect(getSpotifyTracklists()).toEqual([grid]);
  });

  it("rejects an incomplete row instead of assigning an invalid column index", () => {
    const row = document.createElement("div");
    row.innerHTML = '<div aria-colindex="invalid"></div><div aria-colindex="invalid"></div>';
    expect(getSpotifyRowLayout(row)).toBeNull();
  });

  it.each([false, true])("preserves native responsive columns, numbered=%s", (numbered) => {
    const grid = tracklist("modern");
    const layout = getSpotifyRowLayout(getSpotifyTrackRows(grid)[0]);
    const native = `${numbered ? "[index] 16px " : ""}[first] minmax(180px,4fr) [var1] minmax(0,2fr) [last] 120px`;
    grid.style.setProperty("--grid-template-columns", native);
    // jsdom does not inherit custom properties, unlike the real Spotify browser.
    layout.container.style.setProperty("--grid-template-columns", native);
    const template = buildSpotifyColumnTemplate(layout);
    expect(template).toBe(native.replace("[last]", "[tagify] 124px [last]"));
    const previousStyle = layout.container.style.cssText;
    const restore = insertSpotifyColumn(layout, document.createElement("div"), template);
    restore();
    expect(layout.container.style.cssText).toBe(previousStyle);
  });

  it("keeps a directly supplied named layout rather than substituting the inherited template", () => {
    const grid = tracklist("modern");
    const layout = getSpotifyRowLayout(getSpotifyTrackRows(grid)[0]);
    layout.container.style.gridTemplateColumns = "[first] 4fr [var1] 2fr [last] 80px";
    layout.container.style.setProperty("--grid-template-columns", "[index] 16px [first] 4fr [last] 120px");
    expect(buildSpotifyColumnTemplate(layout)).toBe("[first] 4fr [var1] 2fr [tagify] 124px [last] 80px");
  });

  it.each(["main-trackList-rowSectionStart", "hashedCell"])("gives unnumbered recommendation titles flexible space without native widths (%s)", (className) => {
    const row = document.createElement("div");
    row.innerHTML = `<div role="gridcell" aria-colindex="1" class="${className}"><a href="/track/song">Not A Lot Left</a></div><div role="gridcell" aria-colindex="2">Album</div><div role="gridcell" aria-colindex="3">Add</div>`;
    expect(buildSpotifyColumnTemplate(getSpotifyRowLayout(row))).toBe("[first] minmax(0,3fr) [var1] minmax(0,2fr) [tagify] 124px [last] minmax(120px,1fr)");
  });

  it("retains track-number spacing for a numbered playlist without native widths", () => {
    const grid = tracklist("legacy");
    const layout = getSpotifyRowLayout(getSpotifyTrackRows(grid)[0]);
    layout.columns[0].className = "main-trackList-rowSectionStart";
    expect(buildSpotifyColumnTemplate(layout)).toBe("[index] 16px [first] minmax(0,3fr) [var1] minmax(0,2fr) [tagify] 124px [last] minmax(120px,1fr)");
  });
});

describe("Tagify column fitting", () => {
  // Spotify's resolved widths in Liked Songs at three window sizes (2026-11-15).
  const wide = "[index] 16px [first] minmax(180px, 4fr) [var1] minmax(120px, 2fr) [var2] minmax(120px, 2fr) [last] minmax(120px, 1fr)";
  const medium = "[index] 16px [first] minmax(180px, 4fr) [var1] minmax(120px, 2fr) [last] minmax(120px, 1fr)";
  const narrow = "[index] 16px [first] minmax(180px, 4fr) [last] minmax(120px, 1fr)";
  const plan = (resolvedTemplate, availableWidth) =>
    planTagifyColumn({ resolvedTemplate, availableWidth, gap: 16, columnWidth: 124 });

  it("sizes the column to each display mode", () => {
    expect(getTagifyColumnWidth("combined")).toBe(124);
    expect(getTagifyColumnWidth("stars")).toBe(84);
    expect(getTagifyColumnWidth("energy")).toBe(100);
    expect(getTagifyColumnWidth("tags")).toBe(124);
    expect(getTagifyColumnWidth(undefined)).toBe(124);
  });

  it("parses named tracks, including nested functions", () => {
    expect(parseGridTracks("[index] var(--a, 16px) [first] minmax(var(--b), var(--c, 4fr)) [last] 1fr")).toEqual([
      { name: "index", size: "var(--a, 16px)" },
      { name: "first", size: "minmax(var(--b), var(--c, 4fr))" },
      { name: "last", size: "1fr" },
    ]);
  });

  it("keeps every Spotify column when there is room", () => {
    expect(plan(wide, 1150)).toEqual({ show: true, trackNames: ["index", "first", "var1", "var2", "last"], hiddenVariables: [] });
  });

  it("hides Date added before Album when space runs short", () => {
    // Needs 16+180+120+120+120+124 + 5 gaps = 760.
    expect(plan(wide, 712)).toEqual({ show: true, trackNames: ["index", "first", "var1", "last"], hiddenVariables: [1] });
    expect(plan(medium, 569)).toEqual({ show: true, trackNames: ["index", "first", "last"], hiddenVariables: [0] });
    expect(plan(wide, 520)).toEqual({ show: true, trackNames: ["index", "first", "last"], hiddenVariables: [1, 0] });
  });

  it("hides Tagify only when title and duration alone fill the row", () => {
    expect(plan(narrow, 488)).toMatchObject({ show: true, hiddenVariables: [] });
    expect(plan(narrow, 351)).toEqual({ show: false, trackNames: ["index", "first", "last"], hiddenVariables: [] });
  });

  it("builds the template from Spotify's own sizes so its variables stay live", () => {
    const native = "[index] var(--index-column-width, 16px) [first] minmax(var(--first-min-width), 4fr) [var1] minmax(var(--var1-min-width), 2fr) [last] minmax(var(--last-min-width), 1fr)";
    expect(buildTagifyGridTemplate(native, { show: true, trackNames: ["index", "first", "last"], columnWidth: 124 }))
      .toBe("[index] var(--index-column-width, 16px) [first] minmax(var(--first-min-width), 4fr) [tagify] 124px [last] minmax(var(--last-min-width), 1fr)");
    expect(buildTagifyGridTemplate(native, { show: false, trackNames: ["index", "first", "var1", "last"], columnWidth: 124 }))
      .toBe("[index] var(--index-column-width, 16px) [first] minmax(var(--first-min-width), 4fr) [var1] minmax(var(--var1-min-width), 2fr) [last] minmax(var(--last-min-width), 1fr)");
  });
});

describe("Spotify playbar insertion", () => {
  it("keeps the legacy insertion target", () => {
    document.body.innerHTML = '<div class="main-nowPlayingWidget-nowPlaying"><div class="main-trackInfo-container"></div></div>';
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".main-trackInfo-container"));
  });

  it.each(["/track/song", "/album/release", "spotify:album:release", "/local/artist/album/song", "spotify:local:artist:album:song:123"])("finds the song info around a %s link without legacy classes", (href) => {
    document.body.innerHTML = `<div data-testid="now-playing-widget"><div data-testid="cover-art-button"></div><div class="hashedInfo"><div><a href="${href}">Song</a></div><div>Artist</div></div><button>Like</button></div>`;
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".hashedInfo"));
  });

  it("finds a title with no track link", () => {
    document.body.innerHTML = '<div data-testid="now-playing-widget"><div></div><div class="hashedInfo"><span data-testid="context-item-info-title">Song</span></div></div>';
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".hashedInfo"));
  });

  it("uses the album-linked song title rather than its cover", () => {
    document.body.innerHTML = '<div data-testid="now-playing-widget"><a href="/album/release"><img alt="Cover"></a><div class="hashedInfo"><a href="/album/release">Song</a><a href="/artist/artist">Artist</a></div></div>';
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".hashedInfo"));
  });

  it("returns no target while the player is empty, and finds it after Spotify mounts it", () => {
    document.body.innerHTML = '<div data-testid="now-playing-widget"><div data-testid="cover-art-button"></div></div>';
    expect(getSpotifyPlayerAnchor()).toBeNull();
    document.querySelector('[data-testid="now-playing-widget"]').insertAdjacentHTML("beforeend", '<div class="hashedInfo"><a href="/track/song">Song</a></div>');
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".hashedInfo"));
  });

  it("ignores Home shelves of album and playlist cards", () => {
    tracklist("modern");
    const shelf = document.createElement("div");
    shelf.setAttribute("role", "grid");
    shelf.innerHTML = [1, 2, 3].map((index) =>
      `<div role="row"><div role="gridcell" aria-colindex="1">Card</div><div role="gridcell" aria-colindex="2">${index}</div></div>`).join("");
    shelf.querySelectorAll('[role="row"]').forEach((row, index) => fiberWithProps(row, { uri: `spotify:album:${index}` }));
    document.getElementById("main-view").append(shelf);
    expect(getSpotifyTracklists()).not.toContain(shelf);
    expect(getSpotifyTracklists()).toHaveLength(1);
  });

  it("finds header-less track lists by the tracks their rows hold", () => {
    document.body.innerHTML = '<main id="main-view"><div role="grid"></div></main>';
    const grid = document.querySelector('[role="grid"]');
    grid.innerHTML = '<div role="row"><div role="gridcell" aria-colindex="1">1</div><div role="gridcell" aria-colindex="2">Song</div></div>';
    fiberWithProps(grid.querySelector('[role="row"]'), { uri: "spotify:track:abc" });
    expect(getSpotifyTracklists()).toEqual([grid]);
  });

  it("reads a row's item from its nearest React props without searching the whole tree", () => {
    const row = document.createElement("div");
    fiberWithProps(row, { uri: "spotify:track:near" }, 2);
    expect(getRowItemUri(row)).toBe("spotify:track:near");
    const deep = document.createElement("div");
    fiberWithProps(deep, { uri: "spotify:track:far" }, 20);
    expect(getRowItemUri(deep)).toBeNull();
  });
});

function fiberWithProps(element, props, depth = 2) {
  let fiber = { memoizedProps: props, return: null };
  for (let level = 0; level < depth; level++) fiber = { memoizedProps: { children: null }, return: fiber };
  // Walk order: the element's own fiber first, then its parents.
  const chain = [];
  for (let node = fiber; node; node = node.return) chain.push(node);
  chain.reverse();
  for (let index = chain.length - 1; index > 0; index--) chain[index].return = chain[index - 1];
  chain[0].return = null;
  element["__reactFiber$test"] = chain[chain.length - 1];
}
