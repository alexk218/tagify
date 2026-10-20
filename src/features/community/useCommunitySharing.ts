import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import type { SyncStatus } from "@/services/sync/SyncRuntime";
import { getDesktopSyncConfiguration } from "@/services/sync/SyncLocalState";
import { hydrateSyncProfile } from "./communityDevice";
import {
  COMMUNITY_SHARING_CHANGED_EVENT,
  fetchPublicationPolicy,
  publicationState,
  type PublicationState,
} from "./communityPublication";

/** A returning window rechecks at most this often, so switching apps never floods Community. */
const RECHECK_MS = 30_000;

export interface CommunitySharing {
  /** "idle" while not connected or not needed; "error" when the last check failed. */
  phase: "idle" | "loading" | "ready" | "error";
  policy: PublicationPolicyV2 | null;
  state: PublicationState | null;
  handle: string | null;
  refresh: () => void;
}

/**
 * The member's saved sharing choice while a sharing view is open. It loads
 * when one opens, follows saves made anywhere in Tagify, and checks again when
 * Spotify comes back to the front, since Community can publish too.
 */
export function useCommunitySharing({ connected, status, active }: { connected: boolean; status: SyncStatus; active: boolean }): CommunitySharing {
  const [phase, setPhase] = useState<CommunitySharing["phase"]>("idle");
  const [policy, setPolicy] = useState<PublicationPolicyV2 | null>(null);
  const [handle, setHandle] = useState<string | null>(() => getDesktopSyncConfiguration()?.profile?.handle ?? null);
  const loadedAt = useRef(0);
  const request = useRef(0);
  const usable = connected && status !== "reauthorize" && status !== "unlinked";

  const load = useCallback(() => {
    const id = ++request.current;
    loadedAt.current = Date.now();
    setPhase((current) => current === "ready" ? current : "loading");
    void fetchPublicationPolicy().then((next) => {
      if (request.current !== id) return;
      setPolicy(next);
      setPhase("ready");
    }).catch(() => {
      if (request.current !== id) return;
      setPhase("error");
    });
  }, []);

  useEffect(() => {
    if (!connected) {
      request.current++;
      setPolicy(null);
      setPhase("idle");
      return;
    }
    if (active && usable) load();
  }, [active, connected, usable, load]);

  // A review request from Sync while Tagify believes a choice exists means it changed elsewhere.
  const reviewRequested = status === "publication-review-required";
  useEffect(() => {
    if (active && usable && reviewRequested) load();
  }, [active, usable, reviewRequested, load]);

  useEffect(() => {
    if (!active || !usable) return;
    const recheck = () => {
      if (document.visibilityState === "visible" && Date.now() - loadedAt.current >= RECHECK_MS) load();
    };
    document.addEventListener("visibilitychange", recheck);
    return () => document.removeEventListener("visibilitychange", recheck);
  }, [active, usable, load]);

  useEffect(() => {
    const changed = (event: Event) => {
      const next = (event as CustomEvent<{ policy?: PublicationPolicyV2 }>).detail?.policy;
      if (!next) return;
      request.current++;
      loadedAt.current = Date.now();
      setPolicy(next);
      setPhase("ready");
    };
    window.addEventListener(COMMUNITY_SHARING_CHANGED_EVENT, changed);
    return () => window.removeEventListener(COMMUNITY_SHARING_CHANGED_EVENT, changed);
  }, []);

  useEffect(() => {
    const configuration = getDesktopSyncConfiguration();
    if (!active || !connected || !configuration) return;
    if (configuration.profile?.handle) {
      setHandle(configuration.profile.handle);
      return;
    }
    let current = true;
    void hydrateSyncProfile(configuration).then((next) => {
      if (current && next?.profile?.handle) setHandle(next.profile.handle);
    }).catch(() => { /* The profile link waits for the next opening. */ });
    return () => { current = false; };
  }, [active, connected]);

  return {
    phase: connected ? phase : "idle",
    policy: connected ? policy : null,
    state: connected && policy ? publicationState(policy) : null,
    handle: connected ? handle : null,
    refresh: load,
  };
}
