const INLINE_EDITOR_SELECTOR = ".tagify-inline-editor[data-tagify-track-uri]";
const TRACK_ROW_SELECTOR = '[role="row"]';

export function getSelectedInlineTrackUris(root = document) {
  const selectedTrackUris = [];
  const seenTrackUris = new Set();

  root.querySelectorAll(INLINE_EDITOR_SELECTOR).forEach((control) => {
    const trackRow = control.closest(TRACK_ROW_SELECTOR);
    const trackUri = control.dataset.tagifyTrackUri;

    if (
      trackRow?.getAttribute("aria-selected") !== "true" ||
      !trackUri ||
      seenTrackUris.has(trackUri)
    ) {
      return;
    }

    seenTrackUris.add(trackUri);
    selectedTrackUris.push(trackUri);
  });

  return selectedTrackUris;
}

export function getInlineEditScope(trackUri, root = document) {
  const selectedTrackUris = getSelectedInlineTrackUris(root);
  const isBulk =
    selectedTrackUris.length > 1 && selectedTrackUris.includes(trackUri);
  const trackUris = isBulk ? selectedTrackUris : [trackUri];

  return {
    isBulk,
    trackUris,
    trackCount: trackUris.length,
  };
}
