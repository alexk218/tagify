import { useEffect, useState } from "react";
import { REWIND_URL } from "@/features/rewind/rewindPromptRules";
import { syncPairingService, type ApprovedPairing } from "@/services/sync/SyncPairingService";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import type { DesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { fetchCommunityProfile } from "./communityDevice";
import { COMMUNITY_ORIGIN, openCommunityUrl } from "./communityLinks";
import { communityErrorMessage } from "./communitySyncCopy";
import {
  recordCommunityConnectCompleted,
  recordCommunityConnectFinishFailed,
  recordCommunityConnectStarted,
  recordCommunityConnectStartFailed,
  type CommunityConnectEntry,
} from "./communityConnectAnalytics";

export type PendingCommunityPairing = NonNullable<ReturnType<typeof syncPairingService.getPending>>;

export interface CommunityConnection {
  configuration: DesktopSyncConfiguration;
  requiresReload: boolean;
  entry: CommunityConnectEntry;
}

export interface CommunityPairingState {
  entry: CommunityConnectEntry | null;
  /** The code Community is waiting for the member to approve in the browser. */
  pending: PendingCommunityPairing | null;
  /** Approved in the browser, but saving the connection on this computer failed: retry finishes it. */
  approvedPairing: ApprovedPairing | null;
  starting: boolean;
  checking: boolean;
  error: string;
  /** Set once this attempt connected the computer. */
  connection: CommunityConnection | null;
}

const IDLE: CommunityPairingState = {
  entry: null, pending: null, approvedPairing: null, starting: false, checking: false, error: "", connection: null,
};

type Listener = (state: CommunityPairingState) => void;

/**
 * Connecting this computer to Community, kept outside any one screen: the approval happens in the
 * browser, so closing the setup dialog keeps checking until the code expires, and a code that
 * expires while a waiting screen is open is replaced with a fresh one.
 */
export class CommunityPairing {
  private state: CommunityPairingState = IDLE;
  private listeners = new Set<Listener>();
  private connectedListeners = new Set<(connection: CommunityConnection) => void>();
  private watchers = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private polling = false;

  getState(): CommunityPairingState { return this.state; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Called once whenever an attempt connects, including one that finished after its screen closed. */
  onConnected(listener: (connection: CommunityConnection) => void): () => void {
    this.connectedListeners.add(listener);
    return () => { this.connectedListeners.delete(listener); };
  }

  /**
   * A screen that shows the waiting state is open. While any is, an expired code is replaced; when
   * none is, Tagify still checks the current code until it expires.
   */
  watch(): () => void {
    this.watchers += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.watchers = Math.max(0, this.watchers - 1);
    };
  }

  /** Picks up a code that is already waiting, for example one started before Tagify reloaded. */
  adopt(entry: CommunityConnectEntry): void {
    if (this.state.starting || this.state.checking || this.timer) {
      if (!this.state.entry) this.set({ entry });
      return;
    }
    const pending = syncPairingService.getPending();
    this.set({ ...IDLE, entry, pending });
    this.schedule();
  }

  async start(entry: CommunityConnectEntry, options: { renewal?: boolean } = {}): Promise<void> {
    if (this.state.starting) return;
    this.set({ entry, starting: true, error: "", ...(options.renewal ? {} : { approvedPairing: null, connection: null }) });
    try {
      const pending = await syncPairingService.begin(COMMUNITY_ORIGIN, deviceName(), navigator.platform || "Spotify desktop");
      this.set({ pending, approvedPairing: null, starting: false });
      // A renewed code continues the same attempt: the member is already on the page that opened.
      if (!options.renewal) {
        recordCommunityConnectStarted(entry);
        openCommunityUrl(pending.verificationUri);
      }
      this.schedule();
    } catch (error) {
      if (!options.renewal) recordCommunityConnectStartFailed(entry);
      this.set({
        starting: false,
        pending: null,
        error: communityErrorMessage(error, "Couldn't start connecting to Community. Please try again."),
      });
    }
  }

  async check(): Promise<void> {
    if (this.polling) return;
    const entry = this.state.entry ?? "community";
    this.polling = true;
    let completingApproval = false;
    this.set({ checking: true, error: "" });
    try {
      const result = await syncPairingService.poll();
      if (result.status === "approved") {
        const profile = await fetchCommunityProfile(result.approval.configuration.accessToken);
        const approval = profile
          ? { ...result.approval, configuration: { ...result.approval.configuration, profile } }
          : result.approval;
        completingApproval = true;
        this.clearTimer();
        this.set({ approvedPairing: approval, pending: null });
        const connection = await syncPairingService.complete(approval, {
          confirmedAccountSwitch: approval.relationship === "account-switch",
        });
        recordCommunityConnectCompleted(entry, approval.relationship);
        // Someone who connected to see their Rewind lands on it.
        if (entry === "rewind") openCommunityUrl(REWIND_URL);
        const done: CommunityConnection = { configuration: connection.configuration, requiresReload: connection.requiresReload, entry };
        this.set({ approvedPairing: null, connection: done });
        if (!connection.requiresReload) await activeSyncRuntime().activateCurrentAccount();
        for (const listener of this.connectedListeners) listener(done);
      } else {
        this.set({ pending: syncPairingService.getPending() });
      }
    } catch (error) {
      const stillPending = syncPairingService.getPending();
      if (!completingApproval && !stillPending) {
        // The code expired: an unfinished approval, not a failure.
        this.set({ pending: null });
        if (this.watchers > 0) void this.start(entry, { renewal: true });
        return;
      }
      recordCommunityConnectFinishFailed(entry);
      this.set({
        error: communityErrorMessage(error, "Couldn't finish connecting to Community. Please try again."),
        ...(completingApproval ? {} : { pending: stillPending }),
      });
    } finally {
      this.polling = false;
      this.set({ checking: false });
      this.schedule();
    }
  }

  cancel(): void {
    this.clearTimer();
    syncPairingService.cancelPending();
    this.set({ ...IDLE, entry: this.state.entry });
  }

  /** Test-only: forget everything, including screens that were watching. */
  reset(): void {
    this.clearTimer();
    this.watchers = 0;
    this.polling = false;
    this.state = IDLE;
  }

  private schedule(): void {
    this.clearTimer();
    const pending = this.state.pending;
    if (!pending || this.state.connection) return;
    const untilExpiry = Math.max(0, pending.expiresAt - Date.now());
    const delay = Math.min(pending.interval * 1000, untilExpiry + 50);
    // Checking an expired code fails without asking Community, and that failure renews it.
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.check();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private set(next: Partial<CommunityPairingState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) listener(this.state);
  }
}

export const communityPairing = new CommunityPairing();

export function useCommunityPairing(): CommunityPairingState {
  const [state, setState] = useState(() => communityPairing.getState());
  useEffect(() => {
    setState(communityPairing.getState());
    return communityPairing.subscribe(setState);
  }, []);
  return state;
}

function deviceName() { return `Tagify on ${navigator.userAgent.includes("Mac") ? "Mac" : navigator.userAgent.includes("Windows") ? "Windows" : "desktop"}`; }
function activeSyncRuntime() { return window.TagifySync || syncRuntime; }
