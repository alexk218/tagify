import { afterEach, describe, expect, it } from "vitest";
import { isAnotherDialogOpen } from "../openDialogs";

const dialog = (shown: boolean, tag = "div") => {
  const element = document.createElement(tag);
  element.setAttribute("role", "dialog");
  Object.assign(element, { checkVisibility: () => shown });
  document.body.appendChild(element);
  return element;
};

afterEach(() => { document.body.innerHTML = ""; });

describe("isAnotherDialogOpen", () => {
  it("ignores dialogs that are mounted but not shown", () => {
    dialog(false);
    expect(isAnotherDialogOpen()).toBe(false);
  });

  it("counts shown dialogs and Tagify portal content", () => {
    dialog(true);
    expect(isAnotherDialogOpen()).toBe(true);
    document.body.innerHTML = '<div class="tagify-portal"><div>Editing tags</div></div>';
    expect(isAnotherDialogOpen()).toBe(true);
  });

  it("does not count the caller's own dialog or the portal around it", () => {
    const portal = document.createElement("div");
    portal.className = "tagify-portal";
    const own = document.createElement("div");
    own.setAttribute("role", "dialog");
    portal.appendChild(own);
    document.body.appendChild(portal);
    expect(isAnotherDialogOpen(own)).toBe(false);
    dialog(true, "section");
    expect(isAnotherDialogOpen(own)).toBe(true);
  });
});
