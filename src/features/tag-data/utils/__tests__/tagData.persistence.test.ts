import { describe, expect, it, vi } from "vitest";
import { defaultTagData } from "@/constants/defaultTagData";
import { persistTagDataDiff } from "../tagData.persistence";

const { saveAll } = vi.hoisted(() => ({ saveAll: vi.fn() }));
vi.mock("@/services/storage/IndexedDBStorageService", () => ({
  indexedDBStorage: { saveAll },
}));

describe("tag data persistence", () => {
  it("does not replace Smart Playlist rules when a save arrives before initialization", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await persistTagDataDiff(null, defaultTagData)).toBe(false);
      expect(saveAll).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
