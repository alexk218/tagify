import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { emptyPrivateNote, mergeRemotePrivateNotes, privateNotesBackup, PRIVATE_NOTES_CHANGED_EVENT, restorePrivateNotesBackup, savePrivateNote, syncPrivateNotes } from "../PrivateNotes";
import { type DesktopSyncConfiguration, setDesktopSyncConfiguration } from "../SyncLocalState";
import { buildTagifyBackupEnvelopeV2, extractPrivateNotesFromBackup } from "@/features/tag-data/utils/tagData.backup";
import { defaultTagData } from "@/constants/defaultTagData";
const uri = `spotify:track:${"a".repeat(22)}`, other = `spotify:album:${"b".repeat(22)}`;
const cloud = (text: string, revision = 1) => ({ uri, text, revision, updatedAt: "2026-10-08T00:00:00Z" });
beforeEach(async () => { indexedDBStorage.resetConnection(); vi.stubGlobal("indexedDB", new IDBFactory()); await indexedDBStorage.init(); });
afterEach(() => { indexedDBStorage.resetConnection(); localStorage.clear(); vi.unstubAllGlobals(); });
it("saves privately across restart without touching track dates, and carries both conflict copies in file backups", async () => {
  await indexedDBStorage.saveTrack(uri, { rating: 3, energy: 4, bpm: 120, tagIds: [], dateModified: 20 });
  await savePrivateNote(uri, "My private note", "");
  indexedDBStorage.resetConnection(); await indexedDBStorage.init();
  expect((await indexedDBStorage.getPrivateNotes())[0].text).toBe("My private note");
  expect((await indexedDBStorage.getTrack(uri))!.dateModified).toBe(20);
  await mergeRemotePrivateNotes([cloud("Other device's note")]);
  const backup = await privateNotesBackup();
  expect(backup[uri]).toEqual({ text: "My private note", conflictText: "Other device's note" });
  const envelope = buildTagifyBackupEnvelopeV2(defaultTagData, undefined, new Date(), undefined, backup);
  expect(extractPrivateNotesFromBackup(JSON.parse(JSON.stringify(envelope)))).toEqual(backup);
  await savePrivateNote(uri, "", "My private note", true, 1);
  await restorePrivateNotesBackup(backup);
  expect((await indexedDBStorage.getPrivateNotes())[0]).toMatchObject({ text: "My private note", conflict: { text: "Other device's note" } });
});
it("keeps both concurrent versions, requires a reviewed choice, and preserves independent notes", async () => {
  await mergeRemotePrivateNotes([cloud("Original")]);
  await savePrivateNote(uri, "Local edit", "Original");
  await savePrivateNote(other, "Album note", "");
  await mergeRemotePrivateNotes([cloud("Remote edit", 2)]);
  await expect(savePrivateNote(uri, "Local edit", "Local edit")).rejects.toThrow("Review");
  await expect(savePrivateNote(uri, "Local edit", "Local edit", true, 1)).rejects.toThrow("Review");
  await mergeRemotePrivateNotes([cloud("Stale copy", 1)]);
  expect((await indexedDBStorage.getPrivateNotes()).find(note => note.uri === uri)?.conflict?.text).toBe("Remote edit");
  await savePrivateNote(uri, "Combined edit", "Local edit", true, 2);
  expect((await indexedDBStorage.getPrivateNotes()).find(note => note.uri === uri)).toMatchObject({ text: "Combined edit", baseText: "Remote edit", revision: 2, dirty: true, conflict: undefined });
  expect((await privateNotesBackup())[other].text).toBe("Album note");
});
it("keeps an edit made while a cloud acknowledgement is in flight and retries uncertain commits", async () => {
  const configuration = { accountId: "notes-account", deviceId: "device", apiBaseUrl: "https://community.test", accessToken: "fixture-token" } as DesktopSyncConfiguration;
  setDesktopSyncConfiguration(configuration);
  await savePrivateNote(uri, "First", "");
  let submit = true;
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    if (!init?.method) return Response.json({ notes: [], nextCursor: 0, hasMore: false });
    if (submit) { submit = false; await savePrivateNote(uri, "Typed while saving", "First"); }
    return Response.json({ saved: [cloud("First")], conflicts: [] });
  }));
  await syncPrivateNotes(configuration, true);
  expect((await indexedDBStorage.getPrivateNotes())[0]).toMatchObject({ text: "Typed while saving", revision: 1, baseText: "First", dirty: true });
  expect(emptyPrivateNote(uri).dirty).toBe(false);
});
it("leaves notes local when the server lacks support and isolates accounts", async () => {
  await savePrivateNote(uri, "Private", "");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await syncPrivateNotes({ accountId: "unlinked" } as DesktopSyncConfiguration, false);
  expect(fetchMock).not.toHaveBeenCalled();
  localStorage.setItem("tagify:sync:account-id", "another-owner");
  expect(await indexedDBStorage.getPrivateNotes()).toEqual([]);
});

it("does not copy a previous owner's cloud notes into an account switched during the request", async () => {
  const configuration = { accountId: "first-owner", deviceId: "device", apiBaseUrl: "https://community.test", accessToken: "fixture-token" } as DesktopSyncConfiguration;
  setDesktopSyncConfiguration(configuration);
  vi.stubGlobal("fetch", vi.fn(async () => {
    setDesktopSyncConfiguration({ ...configuration, accountId: "second-owner" });
    return Response.json({ notes: [cloud("First owner's private memory")], nextCursor: 1, hasMore: false });
  }));
  await syncPrivateNotes(configuration, true);
  expect(await indexedDBStorage.getPrivateNotes()).toEqual([]);
});

it("keeps a local edit when a newer cloud copy returns to its original value", async () => {
  await mergeRemotePrivateNotes([cloud("Original")]);
  await savePrivateNote(uri, "Local edit", "Original");
  await mergeRemotePrivateNotes([cloud("Remote edit", 2)]);
  await mergeRemotePrivateNotes([cloud("Original", 3)]);
  expect(await indexedDBStorage.getPrivateNote(uri)).toMatchObject({ text: "Local edit", revision: 3, dirty: true, conflict: undefined });
});
it("includes an acknowledged cloud conflict in the next automatic file backup", async () => {
  const configuration = { accountId: "notes-owner", deviceId: "device", apiBaseUrl: "https://community.test", accessToken: "fixture-token" } as DesktopSyncConfiguration;
  setDesktopSyncConfiguration(configuration);
  await savePrivateNote(uri, "Local memory", "");
  const changed = vi.fn();
  const listener = (event: Event) => { if ((event as CustomEvent).detail?.dataChanged) changed(); };
  window.addEventListener(PRIVATE_NOTES_CHANGED_EVENT, listener);
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => Response.json(init?.method
    ? { saved: [], conflicts: [cloud("Other device memory")] }
    : { notes: [], nextCursor: 0, hasMore: false })));
  try {
    await syncPrivateNotes(configuration, true);
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await privateNotesBackup())[uri]).toEqual({ text: "Local memory", conflictText: "Other device memory" });
  } finally { window.removeEventListener(PRIVATE_NOTES_CHANGED_EVENT, listener); }
});
it("reports whether notes reached Community so sync can back off after failures", async () => {
  const configuration = { accountId: "notes-backoff", deviceId: "device", apiBaseUrl: "https://community.test", accessToken: "fixture-token" } as DesktopSyncConfiguration;
  setDesktopSyncConfiguration(configuration);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
  await expect(syncPrivateNotes(configuration, true)).resolves.toBe(false);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ notes: [], nextCursor: 0, hasMore: false })));
  await expect(syncPrivateNotes(configuration, true)).resolves.toBe(true);
  await expect(syncPrivateNotes(configuration, false)).resolves.toBe(true);
});
it("uploads a note edit without reading notes Community reports unchanged", async () => {
  const configuration = { accountId: "notes-unchanged", deviceId: "device", apiBaseUrl: "https://community.test", accessToken: "fixture-token" } as DesktopSyncConfiguration;
  setDesktopSyncConfiguration(configuration);
  await savePrivateNote(uri, "Typed here", "");
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
    requests.push(init?.method || "GET");
    return Response.json({ saved: [cloud("Typed here")], conflicts: [] });
  }));
  await expect(syncPrivateNotes(configuration, true, { remoteCursor: 0 })).resolves.toBe(true);
  expect(requests).toEqual(["PUT"]);
  expect((await indexedDBStorage.getPrivateNotes())[0]).toMatchObject({ text: "Typed here", dirty: false });
});
