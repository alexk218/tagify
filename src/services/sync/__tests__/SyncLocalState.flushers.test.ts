import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.resetModules(); });

// Spotify loads the Tagify page and the background extension as separate
// bundles. Sync runs in the extension, so it must still save edits that the
// page has not written yet before it applies changes from Community.
it("saves pending page edits when sync runs in the other bundle", async () => {
  const page = await import("../SyncLocalState");
  const savePendingEdits = vi.fn(async () => undefined);
  const unregister = page.registerLocalPersistenceFlusher(savePendingEdits);

  vi.resetModules();
  const extension = await import("../SyncLocalState");
  expect(extension).not.toBe(page);
  await extension.flushLocalPersistence();
  expect(savePendingEdits).toHaveBeenCalledTimes(1);

  unregister();
  await extension.flushLocalPersistence();
  expect(savePendingEdits).toHaveBeenCalledTimes(1);
});
