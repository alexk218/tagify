import "../features/onboarding/preview/installSandbox";
// Spotify 1.3.3 can omit Spicetify's legacy classes, even with partial theme aliases.
export const SPOTIFY_TRACK_ROW_SELECTOR = [
  ".main-trackList-trackListRow",
  '[role="row"]:has(> [role="gridcell"][aria-colindex])',
  '[role="row"]:has(> [role="presentation"] > [role="gridcell"][aria-colindex])',
].join(", ");

export const SPOTIFY_TRACK_HEADER_SELECTOR = [
  ".main-trackList-trackListHeaderRow",
  '[role="row"]:has(> [role="columnheader"][aria-colindex])',
  '[role="row"]:has(> [role="presentation"] > [role="columnheader"][aria-colindex])',
].join(", ");

export function getSpotifyTrackRows(tracklist) {
  return Array.from(tracklist.querySelectorAll(SPOTIFY_TRACK_ROW_SELECTOR)).filter(
    (row) => row.closest('.main-trackList-indexable, [role="grid"]') === tracklist,
  );
}

export function getSpotifyTracklistHeader(tracklist) {
  return Array.from(tracklist.querySelectorAll(SPOTIFY_TRACK_HEADER_SELECTOR)).find(
    (row) => row.closest('.main-trackList-indexable, [role="grid"]') === tracklist,
  ) || null;
}

const TRACK_URI = /^spotify:(?:track|local):/;

/**
 * Spotify keeps each row's item URI in the React props a few levels above the
 * row element (two levels in Spotify 1.2.x). Walking only the parent chain keeps
 * this cheap for rows that hold no item at all.
 */
export function getRowItemUri(row, maxDepth = 8) {
  const key = Object.keys(row).find((name) => name.startsWith("__reactFiber$"));
  let fiber = key ? row[key] : null;
  for (let depth = 0; fiber && depth <= maxDepth; depth++, fiber = fiber.return) {
    const props = fiber.memoizedProps;
    if (!props || typeof props !== "object") continue;
    for (const value of [props.uri, props.item?.uri, props.track?.uri, props.value?.uri]) {
      if (typeof value === "string" && value.startsWith("spotify:")) return value;
    }
  }
  return null;
}

export function isSpotifyTrackUri(uri) {
  return typeof uri === "string" && TRACK_URI.test(uri);
}

// Whether a grid is a track list never changes, so each grid is classified once
// it has rendered rows. Home shelves are grids of album/playlist cards.
const tracklistDecisions = new WeakMap();

function isSpotifyTracklist(grid) {
  const known = tracklistDecisions.get(grid);
  if (known !== undefined) return known;
  if (grid.classList.contains("main-trackList-indexable")) {
    const legacy = getSpotifyTrackRows(grid).length > 0 || Boolean(getSpotifyTracklistHeader(grid));
    if (legacy) tracklistDecisions.set(grid, true);
    return legacy;
  }
  if (getSpotifyTracklistHeader(grid)) {
    tracklistDecisions.set(grid, true);
    return true;
  }
  const rows = getSpotifyTrackRows(grid).slice(0, 3);
  if (rows.length === 0) return false;
  const decision = rows.some((row) => isSpotifyTrackUri(getRowItemUri(row)));
  tracklistDecisions.set(grid, decision);
  return decision;
}

export function getSpotifyTracklists(root = document) {
  const candidates = root.querySelectorAll([
    ".main-trackList-indexable",
    '#main-view [role="grid"]',
    '.Root__main-view [role="grid"]',
    'main [role="grid"]',
    '#Desktop_PanelContainer_Id [role="grid"]',
  ].join(", "));
  return Array.from(candidates).filter(isSpotifyTracklist);
}

export function getSpotifyRowLayout(row) {
  const cells = Array.from(row.querySelectorAll("[aria-colindex]")).filter(
    (cell) => cell.parentElement === row ||
      (cell.parentElement?.parentElement === row && cell.parentElement.getAttribute("role") === "presentation"),
  );
  const lastColumn = cells.find((cell) => cell.classList.contains("main-trackList-rowSectionEnd")) || cells.at(-1);
  if (!lastColumn) return null;
  const container = lastColumn.parentElement;
  const columns = cells.filter((cell) => cell.parentElement === container);
  const columnIndex = Number(lastColumn.getAttribute("aria-colindex"));
  if (columns.length < 2 || !Number.isInteger(columnIndex) || columnIndex < 1) return null;
  return { container, columns, lastColumn, columnIndex };
}

export function buildSpotifyColumnTemplate({ container, columns, columnIndex }, columnWidth = getTagifyColumnWidth()) {
  const inlineTemplate = container.style.getPropertyValue("grid-template-columns");
  const nativeTemplate = inlineTemplate.includes("[last]")
    ? inlineTemplate
    : getComputedStyle(container).getPropertyValue("--grid-template-columns");
  // Keep Spotify's responsive widths and named lines. Recommended rows have
  // no track-number column, so a numbered-playlist template squeezes the title.
  if (nativeTemplate.includes("[last]")) {
    return nativeTemplate.replace("[last]", `[tagify] ${columnWidth}px [last]`);
  }

  const first = columns[0];
  const startsWithTitle = columns.length === 2 || Boolean(first.querySelector(
    '.main-trackList-rowMainContentTitle, .main-trackList-rowTitle, [data-testid="internal-track-link"], [data-testid="track-title"], a[href*="/track/"], a[href^="spotify:track:"]',
  ));
  return Array.from({ length: columns.length + 1 }, (_, index) => {
    if (index === columnIndex - 1) return `[tagify] ${columnWidth}px`;
    if (index === columns.length) return "[last] minmax(120px,1fr)";
    if (!startsWithTitle && index === 0) return "[index] 16px";
    if (index === (startsWithTitle ? 0 : 1)) return "[first] minmax(0,3fr)";
    return `[var${startsWithTitle ? index : index - 1}] minmax(0,2fr)`;
  }).join(" ");
}

// Rows that follow the grid's live template read it from this property, so one
// update on the grid re-lays out every row, including rows rendered later.
export const TAGIFY_GRID_TEMPLATE_PROPERTY = "--tagify-grid-template-columns";

// Narrowest width that still fits each display mode's content and the header.
const TAGIFY_COLUMN_WIDTHS = { combined: 124, tags: 124, energy: 100, stars: 84 };

export function getTagifyColumnWidth(displayMode) {
  return TAGIFY_COLUMN_WIDTHS[displayMode] ?? TAGIFY_COLUMN_WIDTHS.combined;
}

/** Whether a row's columns come from the grid's `--grid-template-columns`. */
export function usesSpotifyGridTemplate({ container }) {
  const inlineTemplate = container.style.getPropertyValue("grid-template-columns");
  if (inlineTemplate.includes("[last]")) return false;
  return getComputedStyle(container).getPropertyValue("--grid-template-columns").includes("[last]");
}

/** Splits `[index] 16px [first] minmax(...) ...` into named tracks. */
export function parseGridTracks(template) {
  return (template || "").trim().split(/(?=\[[\w-]+\])/).flatMap((part) => {
    const match = part.match(/^\[([\w-]+)\]\s*([\s\S]*)$/);
    return match ? [{ name: match[1], size: match[2].trim() }] : [];
  });
}

function getTrackMinWidth(size) {
  const minmax = size.match(/^minmax\(\s*([\d.]+)px/);
  if (minmax) return Number(minmax[1]);
  const fixed = size.match(/^([\d.]+)px$/);
  return fixed ? Number(fixed[1]) : 0;
}

/**
 * Decides how the Tagify column fits a track list of `availableWidth`.
 * Spotify picks its columns without knowing about ours, so when its minimum
 * widths plus Tagify don't fit, Spotify's least important columns give way,
 * last first (Date added, then Album). With none left, Tagify hides too, the
 * same way Spotify hides Album in narrow windows.
 *
 * `resolvedTemplate` must have its sizes resolved (getComputedStyle), so the
 * minimum widths are plain pixels. Returns the kept track names (in order),
 * the variable columns hidden for room (`hiddenVariables`, by position among
 * Spotify's visible variable columns) and whether Tagify shows.
 */
export function planTagifyColumn({ resolvedTemplate, availableWidth, gap = 0, columnWidth }) {
  let tracks = parseGridTracks(resolvedTemplate);
  const variables = tracks.filter((track) => track.name.startsWith("var"));
  const fits = (list) =>
    list.reduce((sum, track) => sum + getTrackMinWidth(track.size), 0) + columnWidth + gap * list.length <= availableWidth;

  for (let hidden = 0; hidden <= variables.length; hidden += 1) {
    if (hidden > 0) {
      const removed = variables[variables.length - hidden];
      tracks = tracks.filter((track) => track !== removed);
    }
    if (fits(tracks)) {
      return {
        show: true,
        trackNames: tracks.map((track) => track.name),
        hiddenVariables: Array.from({ length: hidden }, (_, index) => variables.length - 1 - index),
      };
    }
  }
  return { show: false, trackNames: parseGridTracks(resolvedTemplate).map((track) => track.name), hiddenVariables: [] };
}

/**
 * Builds the grid template from Spotify's own (unresolved) template, keeping
 * only `trackNames` and adding Tagify before `[last]`.
 */
export function buildTagifyGridTemplate(nativeTemplate, { show, trackNames, columnWidth }) {
  const keep = new Set(trackNames);
  return parseGridTracks(nativeTemplate)
    .filter((track) => keep.has(track.name))
    .flatMap((track) => (show && track.name === "last"
      ? [`[tagify] ${columnWidth}px`, `[last] ${track.size}`]
      : [`[${track.name}] ${track.size}`]))
    .join(" ");
}

const INSERTED_COLUMN_ATTRIBUTE = "data-tagify-inserted-column";

export function insertSpotifyColumn(layout, column, gridTemplate) {
  const { container, lastColumn, columnIndex } = layout;
  const originalIndex = lastColumn.getAttribute("aria-colindex");
  const originalTemplate = container.style.getPropertyValue("grid-template-columns");
  const originalPriority = container.style.getPropertyPriority("grid-template-columns");
  column.setAttribute("aria-colindex", String(columnIndex));
  column.setAttribute(INSERTED_COLUMN_ATTRIBUTE, "");
  lastColumn.setAttribute("aria-colindex", String(columnIndex + 1));
  container.insertBefore(column, lastColumn);
  // Preserve Spotify's positioning/height styles, including virtualized row wrappers.
  container.style.setProperty("grid-template-columns", gridTemplate, "important");
  return () => {
    column.remove();
    // Spotify can drop a cell and Tagify re-adds one to the same row. That
    // newer cell owns the row's template now, so a stale restore leaves it be.
    const replacement = Array.from(container.children).some((child) => child.hasAttribute(INSERTED_COLUMN_ATTRIBUTE));
    if (replacement) return;
    lastColumn.setAttribute("aria-colindex", originalIndex);
    if (originalTemplate) container.style.setProperty("grid-template-columns", originalTemplate, originalPriority);
    else container.style.removeProperty("grid-template-columns");
  };
}

export function getSpotifyPlayerAnchor(root = document) {
  const widget = root.querySelector('[data-testid="now-playing-widget"], .main-nowPlayingWidget-nowPlaying');
  if (!widget) return null;
  const legacyInfo = widget.querySelector(".main-trackInfo-container, .main-nowPlayingWidget-trackInfo");
  if (legacyInfo) return legacyInfo;
  let info = widget.querySelector([
    '[data-testid="context-item-info"]',
    '[data-testid="context-item-info-title"]',
    'a[href*="/track/"]',
    'a[href^="spotify:track:"]',
    'a[href*="/local/"]',
    'a[href^="spotify:local:"]',
  ].join(", "));
  // Current song titles open the album. Skip cover links and use the text block.
  if (!info) info = Array.from(widget.querySelectorAll('a[href*="/album/"], a[href^="spotify:album:"]')).find(
    link => link.textContent.trim() && !link.closest('[data-testid="cover-art-button"]'),
  );
  if (!info) return null;
  while (info.parentElement !== widget) info = info.parentElement;
  return info;
}
