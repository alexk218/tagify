import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { useTastePacks } from "../useTastePacks";

const { addTastePacks, recordProductInteraction, recordTastePacksAdded } = vi.hoisted(() => ({
  addTastePacks: vi.fn(), recordProductInteraction: vi.fn(), recordTastePacksAdded: vi.fn(),
}));
vi.mock("../../services/tastePacks", () => ({ addTastePacks }));
vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction, recordTastePacksAdded }));

type Options = Parameters<typeof useTastePacks>[0];
const STEP_KEY = "tagify:taste-packs:v1";
const options = (overrides: Partial<Options> = {}): Options => ({
  taxonomy: defaultTagData.taxonomy,
  isLoading: false,
  taggedTrackCount: 0,
  restoreOnOffer: false,
  showSavedTags: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});
const render = (initial: Options) => renderHook((props: Options) => useTastePacks(props), { initialProps: initial });

beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

it("shows the step once the install that offers it has finished loading the library", () => {
  const hook = render(options({ isLoading: true }));
  expect(hook.result.current.showTastePacks).toBe(false);
  localStorage.setItem(STEP_KEY, "offered");
  hook.rerender(options());
  expect(hook.result.current.showTastePacks).toBe(true);
  expect(hook.result.current.tastePackChoices).toHaveLength(11);
});

it("never shows it to a library without the fresh-install mark", () => {
  expect(render(options()).result.current.showTastePacks).toBe(false);
});

it("hides it once a song is tagged or while Community offers a restore", () => {
  localStorage.setItem(STEP_KEY, "offered");
  const hook = render(options({ restoreOnOffer: true }));
  expect(hook.result.current.showTastePacks).toBe(false);
  hook.rerender(options({ taggedTrackCount: 1 }));
  expect(hook.result.current.showTastePacks).toBe(false);
  hook.rerender(options());
  expect(hook.result.current.showTastePacks).toBe(true);
});

it("answers the step for good when packs are added, and shows the saved tags", async () => {
  localStorage.setItem(STEP_KEY, "offered");
  addTastePacks.mockResolvedValue([{ key: "metal", folderId: "sub_svf6di", added: ["tag_1iy4qy4"], skipped: [] }]);
  const showSavedTags = vi.fn().mockResolvedValue(undefined);
  const hook = render(options({ showSavedTags }));
  await act(async () => { await hook.result.current.addTastePacks(["metal"]); });
  expect(addTastePacks).toHaveBeenCalledWith(["metal"]);
  expect(showSavedTags).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(STEP_KEY)).toBe("added");
  expect(hook.result.current.showTastePacks).toBe(false);
  expect(recordTastePacksAdded).toHaveBeenCalledWith(["metal"], "first_run");
});

it("keeps asking when the packs couldn't be added", async () => {
  localStorage.setItem(STEP_KEY, "offered");
  addTastePacks.mockRejectedValue(new Error("Your tags couldn't be added. Try again in a moment."));
  const hook = render(options());
  await act(async () => { await expect(hook.result.current.addTastePacks(["metal"])).rejects.toThrow(); });
  expect(localStorage.getItem(STEP_KEY)).toBe("offered");
  expect(hook.result.current.showTastePacks).toBe(true);
  expect(recordTastePacksAdded).not.toHaveBeenCalled();
});

it("answers the step for good when skipped", () => {
  localStorage.setItem(STEP_KEY, "offered");
  const hook = render(options());
  act(() => hook.result.current.skipTastePacks());
  expect(localStorage.getItem(STEP_KEY)).toBe("skipped");
  expect(hook.result.current.showTastePacks).toBe(false);
  expect(recordProductInteraction).toHaveBeenCalledWith("taste_packs_skipped");
  expect(recordTastePacksAdded).not.toHaveBeenCalled();
});
