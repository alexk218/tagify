import { beforeEach, describe, expect, it } from "vitest";
import {
  getInlineEditScope,
  getSelectedInlineTrackUris,
} from "../inlineEditor.selection";

function appendTrackRow(trackUri, selected = false) {
  const row = document.createElement("div");
  row.setAttribute("role", "row");
  row.setAttribute("aria-selected", String(selected));

  const control = document.createElement("div");
  control.className = "tagify-inline-editor";
  control.dataset.tagifyTrackUri = trackUri;
  row.appendChild(control);
  document.body.appendChild(row);

  return control;
}

describe("inline editor selection scope", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("uses every selected track when the edited track belongs to the selection", () => {
    appendTrackRow("spotify:track:one", true);
    appendTrackRow("spotify:track:two", true);
    appendTrackRow("spotify:track:three", false);

    expect(getSelectedInlineTrackUris()).toEqual([
      "spotify:track:one",
      "spotify:track:two",
    ]);
    expect(getInlineEditScope("spotify:track:one")).toEqual({
      isBulk: true,
      trackUris: ["spotify:track:one", "spotify:track:two"],
      trackCount: 2,
    });
  });

  it("keeps an unselected track edit scoped to that track", () => {
    appendTrackRow("spotify:track:one", true);
    appendTrackRow("spotify:track:two", true);
    appendTrackRow("spotify:track:three", false);

    expect(getInlineEditScope("spotify:track:three")).toEqual({
      isBulk: false,
      trackUris: ["spotify:track:three"],
      trackCount: 1,
    });
  });

  it("keeps a single selected track edit scoped to that track", () => {
    appendTrackRow("spotify:track:one", true);

    expect(getInlineEditScope("spotify:track:one")).toEqual({
      isBulk: false,
      trackUris: ["spotify:track:one"],
      trackCount: 1,
    });
  });

  it("deduplicates a selected track shown in more than one inline control", () => {
    appendTrackRow("spotify:track:one", true);
    appendTrackRow("spotify:track:one", true);
    appendTrackRow("spotify:track:two", true);

    expect(getSelectedInlineTrackUris()).toEqual([
      "spotify:track:one",
      "spotify:track:two",
    ]);
  });
});
