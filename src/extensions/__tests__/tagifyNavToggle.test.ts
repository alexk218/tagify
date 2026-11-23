import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initializeTagifyNavToggle, isTagifyPath } from "../tagifyNavToggle";

type Location = { pathname: string; search?: string; hash?: string; state?: unknown };

let location: Location;
let listeners: Array<() => void>;
const push = vi.fn((to: Location) => navigate(to));
const navigate = (to: Location) => {
  location = to;
  listeners.forEach((listener) => listener());
};
let dispose: () => void;

/** Stands in for Spicetify's own button, which opens Tagify through React. */
function addTagifyButton() {
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Tagify");
  button.innerHTML = "<svg><path></path></svg>";
  button.addEventListener("click", () => push({ pathname: "/tagify" }));
  document.body.appendChild(button);
  return button;
}

beforeEach(() => {
  location = { pathname: "/" };
  listeners = [];
  push.mockClear();
  vi.stubGlobal("Spicetify", {
    Platform: {
      History: {
        get location() { return location; },
        push,
        listen: (listener: () => void) => {
          listeners.push(listener);
          return () => { listeners = listeners.filter((l) => l !== listener); };
        },
      },
    },
  });
});

afterEach(() => {
  dispose?.();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

it("opens Tagify, then a second click returns to the page that was open before", () => {
  dispose = initializeTagifyNavToggle();
  const button = addTagifyButton();
  const playlist = { pathname: "/playlist/abc", search: "?x=1", hash: "", state: { from: "sidebar" } };
  navigate(playlist);

  button.click();
  expect(location.pathname).toBe("/tagify");

  button.querySelector("path")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(location).toEqual(playlist);
  expect(push).toHaveBeenCalledTimes(2);
});

it("skips pages visited inside Tagify and goes Home when nothing was open before", () => {
  location = { pathname: "/tagify" };
  dispose = initializeTagifyNavToggle();
  const button = addTagifyButton();
  navigate({ pathname: "/tagify", search: "?view=stats" });

  button.click();
  expect(location).toEqual({ pathname: "/", search: "", hash: "" });
});

it("leaves other buttons and a removed toggle alone", () => {
  dispose = initializeTagifyNavToggle();
  const button = addTagifyButton();
  navigate({ pathname: "/tagify" });
  const other = document.createElement("button");
  other.setAttribute("aria-label", "Home");
  document.body.appendChild(other);
  other.click();
  expect(push).not.toHaveBeenCalled();

  dispose();
  button.click();
  expect(location.pathname).toBe("/tagify");
});

it("recognizes Tagify's pages", () => {
  expect(isTagifyPath("/tagify")).toBe(true);
  expect(isTagifyPath("/tagify/stats")).toBe(true);
  expect(isTagifyPath("/tagifyx")).toBe(false);
  expect(isTagifyPath("/")).toBe(false);
});
