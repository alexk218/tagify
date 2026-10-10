import { afterEach, expect, it, vi } from "vitest";
import { dispatchTagDataUpdatedEvent, isUnshownTagDataUpdate } from "../tagData.events";

afterEach(() => { vi.restoreAllMocks(); });

function lastDetail(type: Parameters<typeof dispatchTagDataUpdatedEvent>[0], options?: Parameters<typeof dispatchTagDataUpdatedEvent>[1]) {
  let detail: unknown;
  const listener = (event: Event) => { detail = (event as CustomEvent).detail; };
  window.addEventListener("tagify:dataUpdated", listener);
  dispatchTagDataUpdatedEvent(type, options);
  window.removeEventListener("tagify:dataUpdated", listener);
  return detail as Parameters<typeof isUnshownTagDataUpdate>[0];
}

it("shows saves from other parts of Tagify, but not ones whose records were already sent", () => {
  expect(isUnshownTagDataUpdate({ type: "save", sourceId: "other-bundle" })).toBe(true);
  expect(isUnshownTagDataUpdate({ type: "save", sourceId: "other-bundle", recordsAnnounced: true })).toBe(false);
  expect(isUnshownTagDataUpdate(lastDetail("save"))).toBe(false);
  expect(isUnshownTagDataUpdate(lastDetail("smartPlaylistSync"))).toBe(true);
  expect(isUnshownTagDataUpdate({ type: "sync", origin: "remote" })).toBe(true);
  expect(isUnshownTagDataUpdate({ type: "sync", origin: "local" })).toBe(false);
});
