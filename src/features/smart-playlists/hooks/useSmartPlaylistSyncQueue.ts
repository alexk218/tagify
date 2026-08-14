import { useCallback, useRef } from "react";
import { SyncOperation } from "@/features/smart-playlists/model/useSmartPlaylists.types";

export function useSmartPlaylistSyncQueue() {
  const queueProcessorRef = useRef<Promise<void> | null>(null);
  const syncQueueRef = useRef<SyncOperation[]>([]);

  const processSyncQueue = useCallback(async () => {
    if (queueProcessorRef.current) {
      await queueProcessorRef.current;
      return;
    }

    if (syncQueueRef.current.length === 0) {
      return;
    }

    queueProcessorRef.current = (async () => {
      try {
        while (syncQueueRef.current.length > 0) {
          const operation = syncQueueRef.current.shift();
          if (!operation) {
            continue;
          }

          const startTime = Date.now();

          try {
            await operation.execute();
          } catch (error) {
            const duration = Date.now() - startTime;
            console.error(
              `FAILED operation ${operation.id} after ${duration}ms:`,
              error,
            );
          }
        }
      } finally {
        queueProcessorRef.current = null;
      }
    })();

    await queueProcessorRef.current;
  }, []);

  const enqueueSyncOperation = useCallback(
    (operation: SyncOperation) => {
      syncQueueRef.current.push(operation);
      void processSyncQueue();
    },
    [processSyncQueue],
  );

  return {
    enqueueSyncOperation,
  };
}
