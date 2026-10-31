import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { welcomeModal } from "../WelcomeModal";

const { getTrackCount, recordProductInteraction } = vi.hoisted(() => ({ getTrackCount: vi.fn(), recordProductInteraction: vi.fn() }));
vi.mock("@/services/storage/IndexedDBStorageService", () => ({ indexedDBStorage: { getTrackCount } }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction }));

const push = vi.fn();
const callout = () => document.getElementById("tagify-welcome-callout");

function addTagifyButton() {
  const button = document.createElement("button");
  button.setAttribute("aria-label", "Tagify");
  document.body.appendChild(button);
  return button;
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("Spicetify", { Platform: { History: { push } } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  document.getElementById("tagify-onboarding-styles")?.remove();
});

const start = async (wait = 1000) => {
  welcomeModal.initialize();
  await vi.advanceTimersByTimeAsync(wait);
};

it("points a fresh install at the Tagify button and opens Tagify from the callout", async () => {
  getTrackCount.mockResolvedValue(0);
  addTagifyButton();
  await start();

  expect(callout()).toHaveTextContent("Tagify is here");
  expect(recordProductInteraction).toHaveBeenCalledWith("welcome_popup_shown");
  expect(localStorage.getItem("tagify:lastSeenVersion")).toBeTruthy();
  (callout()!.querySelector(".tagify-welcome-callout-go") as HTMLButtonElement).click();
  expect(callout()).toBeNull();
  expect(push).toHaveBeenCalledWith("/tagify");
});

it("goes away when they close it or use the Tagify button itself", async () => {
  getTrackCount.mockResolvedValue(0);
  const button = addTagifyButton();
  await start();
  (callout()!.querySelector(".tagify-welcome-callout-close") as HTMLButtonElement).click();
  expect(callout()).toBeNull();
  expect(push).not.toHaveBeenCalled();

  localStorage.clear();
  await start();
  button.click();
  expect(callout()).toBeNull();
});

it("opens Tagify when Spotify's Tagify button never appears", async () => {
  getTrackCount.mockResolvedValue(0);
  await start(12_000);
  expect(callout()).toBeNull();
  expect(push).toHaveBeenCalledWith("/tagify");
});

it("stays quiet after an update", async () => {
  localStorage.setItem("tagify:lastSeenVersion", "3.3.1");
  getTrackCount.mockResolvedValue(0);
  addTagifyButton();
  await start();

  expect(callout()).toBeNull();
  expect(recordProductInteraction).not.toHaveBeenCalled();
  expect(localStorage.getItem("tagify:lastSeenVersion")).not.toBe("3.3.1");
});

it("stays quiet on a reinstall over saved songs, or when the library can't be read", async () => {
  addTagifyButton();
  getTrackCount.mockResolvedValue(12);
  await start();
  expect(callout()).toBeNull();

  localStorage.clear();
  getTrackCount.mockRejectedValue(new Error("blocked"));
  await start();
  expect(callout()).toBeNull();
  expect(recordProductInteraction).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
});
