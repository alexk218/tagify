import { useCallback, useEffect, useState } from "react";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { PRIVATE_NOTES_CHANGED_EVENT } from "@/services/sync/PrivateNotes.types";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";

/** Read only the visible music's notes, independently of its public annotations. */
export function usePrivateNotePreviews(uris: string[]) {
  const account = getTagifyDatabaseName();
  const uriKey = JSON.stringify([...new Set(uris)]);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState<{
    account: string;
    texts: Record<string, string>;
    error: boolean;
  }>({ account, texts: {}, error: false });
  const retry = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ dataChanged?: boolean }>).detail?.dataChanged !== false) retry();
    };
    const accountChanged = () => {
      if (account !== getTagifyDatabaseName()) retry();
    };
    window.addEventListener(PRIVATE_NOTES_CHANGED_EVENT, changed);
    window.addEventListener("tagify:syncStatus", accountChanged);
    window.addEventListener("storage", accountChanged);
    return () => {
      window.removeEventListener(PRIVATE_NOTES_CHANGED_EVENT, changed);
      window.removeEventListener("tagify:syncStatus", accountChanged);
      window.removeEventListener("storage", accountChanged);
    };
  }, [account, retry]);

  useEffect(() => {
    let cancelled = false;
    const visibleUris: string[] = JSON.parse(uriKey);
    if (visibleUris.length === 0) {
      setSaved({ account, texts: {}, error: false });
      return;
    }
    void indexedDBStorage.getPrivateNotesForUris(visibleUris, account).then(notes => {
      if (!cancelled && account === getTagifyDatabaseName()) {
        setSaved({ account, texts: Object.fromEntries(notes.map(note => [note.uri, note.text])), error: false });
      }
    }).catch(() => {
      if (!cancelled && account === getTagifyDatabaseName()) setSaved({ account, texts: {}, error: true });
    });
    return () => { cancelled = true; };
  }, [account, uriKey, revision]);

  return { texts: saved.account === account ? saved.texts : {}, error: saved.account === account && saved.error, retry };
}
