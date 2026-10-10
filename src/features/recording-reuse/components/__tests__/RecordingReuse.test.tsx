import React, { useState } from "react";
import { IDBFactory } from "fake-indexeddb";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RecordingReuse } from "../RecordingReuse";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { defaultTagData } from "@/constants/defaultTagData";
const a = `spotify:track:${"a".repeat(22)}`, b = `spotify:track:${"b".repeat(22)}`;
const original = { rating: 3, energy: 4, bpm: 120, tagIds: [], name: "Song", albumName: "Original", dateModified: 20 };
const tracks = { [a]: original, [b]: { ...original, rating: 1, albumName: "Compilation" } };
beforeEach(async () => {
  indexedDBStorage.resetConnection(); vi.stubGlobal("indexedDB", new IDBFactory());
  await indexedDBStorage.init(); await indexedDBStorage.saveAll({ ...defaultTagData, tracks });
  vi.spyOn(spotifyApiService, "getRecordingIdentity").mockResolvedValue({ isrc: "USABC2400001", artistIds: ["c".repeat(22)], durationMs: 180000, name: "Song" });
});
afterEach(() => { indexedDBStorage.resetConnection(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function Preview() {
  const [data, setData] = useState(tracks);
  return <RecordingReuse track={{ uri: a, name: "Song", artists: [], album: { name: "Original", uri: null, images: [] }, duration_ms: 180000 }} tracks={data} taxonomy={defaultTagData.taxonomy}
    onChanged={async () => { setData((await indexedDBStorage.loadAllStrict()).tracks as typeof tracks); }} />;
}
it("requires conflict review, links the chosen values, and unlinks without erasing them", async () => {
  render(<Preview />);
  expect(spotifyApiService.getRecordingIdentity).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText(/Other releases of this recording/));
  fireEvent.click(screen.getByRole("button", { name: "Check saved releases" }));
  await waitFor(() => expect(screen.getByText(/2 releases confirmed/)).toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Link confirmed releases" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Recording tagging to keep"), { target: { value: b } });
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Link confirmed releases" }));
  await waitFor(() => expect(screen.getByText(/Releases linked/)).toBeInTheDocument());
  expect((await indexedDBStorage.getTrack(a))!.rating).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "Unlink this release" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Allow recording reuse" })).toBeInTheDocument());
  expect(await indexedDBStorage.getTrack(a)).toMatchObject({ rating: 1, recordingReuseDisabled: true });
});
it("keeps API failures separate from confirmation and permits retry", async () => {
  vi.mocked(spotifyApiService.getRecordingIdentity).mockRejectedValueOnce(new Error("Wait, then try again."));
  render(<Preview />); fireEvent.click(screen.getByText(/Other releases of this recording/));
  fireEvent.click(screen.getByRole("button", { name: "Check saved releases" }));
  await waitFor(() => expect(screen.getByText("Wait, then try again.")).toBeInTheDocument());
  expect(screen.queryByRole("button", { name: "Link confirmed releases" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Check saved releases" })).toBeEnabled();
});
