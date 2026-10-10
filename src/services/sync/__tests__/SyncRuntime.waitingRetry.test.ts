import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import type { DesktopSyncConfiguration } from "../SyncLocalState";
import { syncPairingService } from "../SyncPairingService";
import { syncRuntime } from "../SyncRuntime";

const configuration = { accountId: "waiting-account", libraryId: "waiting-library", deviceId: "waiting-device" } as DesktopSyncConfiguration;
type RuntimeInternals = {
  run(configuration: DesktopSyncConfiguration): Promise<void>;
  consecutiveFailures: number;
  automaticRetryNotBefore: number;
  capabilities: unknown;
};

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  expect(await indexedDBStorage.init()).toBe(true);
});
afterEach(() => { indexedDBStorage.resetConnection(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

// A single change Community hasn't confirmed yet must not slow every other
// backup down: it is retried in a couple of minutes, not after an hour.
it("retries a waiting change soon without growing the failure backoff", async () => {
  const runtime = syncRuntime as unknown as RuntimeInternals & Record<string, unknown>;
  runtime.consecutiveFailures = 5;
  runtime.capabilities = { protocolVersion: 2, supportedProtocolVersions: [1, 2] };
  vi.spyOn(runtime as never, "refreshIfNeeded").mockResolvedValue(configuration as never);
  vi.spyOn(runtime as never, "request").mockResolvedValue({ library: { counts: {} } } as never);
  vi.spyOn(runtime as never, "ensureReplicaReady").mockResolvedValue(true as never);
  vi.spyOn(syncPairingService, "recoverLegacyReplica").mockResolvedValue(undefined as never);
  vi.spyOn(runtime as never, "settleLocalAndPublicSync").mockRejectedValue(new Error("sync_waiting: Some changes are still waiting to back up.") as never);
  const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

  const before = Date.now();
  await runtime.run(configuration);

  expect(logged.mock.calls.map((call) => String(call[1]))).toEqual([expect.stringContaining("sync_waiting")]);
  expect(runtime.consecutiveFailures).toBe(0);
  expect(runtime.automaticRetryNotBefore - before).toBeLessThanOrEqual(2 * 60_000 + 1_000);
  expect(runtime.automaticRetryNotBefore).toBeGreaterThan(before);
});
