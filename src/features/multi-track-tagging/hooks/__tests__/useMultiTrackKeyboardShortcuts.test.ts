import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMultiTrackKeyboardShortcuts } from "../useMultiTrackKeyboardShortcuts";

const press = (target: EventTarget, code: string, shiftKey = false) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { code, shiftKey, bubbles: true, cancelable: true }));

const render = () => {
  const options = {
    hasUnsavedChanges: false,
    onSaveChanges: vi.fn(),
    onToggleStarRatingDraft: vi.fn(),
    onToggleEnergyRatingDraft: vi.fn(),
  };
  renderHook(() => useMultiTrackKeyboardShortcuts(options));
  return options;
};

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("bulk rating shortcuts", () => {
  it("rate the selected songs from the page", () => {
    const { onToggleStarRatingDraft, onToggleEnergyRatingDraft } = render();
    document.body.innerHTML = `<button id="tag">Chill</button>`;

    press(document.getElementById("tag")!, "Digit6");
    press(document.body, "Digit3", true);

    expect(onToggleStarRatingDraft).toHaveBeenCalledWith(3);
    expect(onToggleEnergyRatingDraft).toHaveBeenCalledWith(3);
  });

  it("leave keys pressed in the Invite a friend panel alone", () => {
    const { onToggleStarRatingDraft, onToggleEnergyRatingDraft } = render();
    document.body.innerHTML = `
      <div role="dialog" aria-labelledby="tagify-invite-title">
        <div id="link" role="textbox" aria-readonly="true" tabindex="0">https://community.tagify.fm/join/alex</div>
        <button id="copy">Copy link</button>
      </div>`;

    const copy = document.getElementById("copy")!;
    expect(press(copy, "Digit5")).toBe(true);
    press(copy, "Digit2", true);
    press(document.getElementById("link")!, "Digit8");

    expect(onToggleStarRatingDraft).not.toHaveBeenCalled();
    expect(onToggleEnergyRatingDraft).not.toHaveBeenCalled();
  });
});
