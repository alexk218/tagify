import { afterEach, describe, expect, it } from "vitest";
import {
  getSpotifyPlayerAnchor,
  getSpotifyRowLayout,
  getSpotifyTracklistHeader,
  getSpotifyTracklists,
  getSpotifyTrackRows,
  insertSpotifyColumn,
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
});

describe("Spotify playbar insertion", () => {
  it("keeps the legacy insertion target", () => {
    document.body.innerHTML = '<div class="main-nowPlayingWidget-nowPlaying"><div class="main-trackInfo-container"></div></div>';
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".main-trackInfo-container"));
  });

  it.each(["/track/song", "/local/artist/album/song", "spotify:local:artist:album:song:123"])("finds the song info around a %s link without legacy classes", (href) => {
    document.body.innerHTML = `<div data-testid="now-playing-widget"><div data-testid="cover-art-button"></div><div class="hashedInfo"><div><a href="${href}">Song</a></div><div>Artist</div></div><button>Like</button></div>`;
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".hashedInfo"));
  });

  it("finds a title with no track link", () => {
    document.body.innerHTML = '<div data-testid="now-playing-widget"><div></div><div class="hashedInfo"><span data-testid="context-item-info-title">Song</span></div></div>';
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".hashedInfo"));
  });

  it("returns no target while the player is empty, and finds it after Spotify mounts it", () => {
    document.body.innerHTML = '<div data-testid="now-playing-widget"><div data-testid="cover-art-button"></div></div>';
    expect(getSpotifyPlayerAnchor()).toBeNull();
    document.querySelector('[data-testid="now-playing-widget"]').insertAdjacentHTML("beforeend", '<div class="hashedInfo"><a href="/track/song">Song</a></div>');
    expect(getSpotifyPlayerAnchor()).toBe(document.querySelector(".hashedInfo"));
  });
});
