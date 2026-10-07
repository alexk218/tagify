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

export function getSpotifyTracklists(root = document) {
  const candidates = root.querySelectorAll([
    ".main-trackList-indexable",
    '#main-view [role="grid"]',
    '.Root__main-view [role="grid"]',
    'main [role="grid"]',
    '#Desktop_PanelContainer_Id [role="grid"]',
  ].join(", "));
  return Array.from(candidates).filter(
    (grid) => getSpotifyTrackRows(grid).length > 0 || getSpotifyTracklistHeader(grid),
  );
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

export function insertSpotifyColumn(layout, column, gridTemplate) {
  const { container, lastColumn, columnIndex } = layout;
  const originalIndex = lastColumn.getAttribute("aria-colindex");
  const originalTemplate = container.style.getPropertyValue("grid-template-columns");
  const originalPriority = container.style.getPropertyPriority("grid-template-columns");
  column.setAttribute("aria-colindex", String(columnIndex));
  lastColumn.setAttribute("aria-colindex", String(columnIndex + 1));
  container.insertBefore(column, lastColumn);
  // Preserve Spotify's positioning/height styles, including virtualized row wrappers.
  container.style.setProperty("grid-template-columns", gridTemplate, "important");
  return () => {
    column.remove();
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
  if (!info) return null;
  while (info.parentElement !== widget) info = info.parentElement;
  return info;
}
