import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { trackArtistIdentitiesStore } from "@/services/trackArtistIdentities";
import { playlistMembershipStore } from "@/features/track-insights/services/playlistMembership";
import { albumTrackListsStore } from "@/features/playlist-state/services/albumTrackLists";
import { getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import type { BatchTagUpdate, TagDataStructure } from "@/types/tagData";
import { readRuleFacts, subscribeRuleFacts } from "./facts";
import { readRules, subscribeRules, pauseRules } from "./store";
import { planRule, ruleCandidates, ruleMatch, type RuleContext } from "./rules";

export function useRuleContext(): RuleContext {
  const facts = useSyncExternalStore(subscribeRuleFacts, readRuleFacts);
  const artists = useSyncExternalStore(trackArtistIdentitiesStore.subscribe, trackArtistIdentitiesStore.getSnapshot);
  const playlists = useSyncExternalStore(playlistMembershipStore.subscribe, playlistMembershipStore.getSnapshot);
  const albums = useSyncExternalStore(albumTrackListsStore.subscribe, albumTrackListsStore.getSnapshot);
  return useMemo(() => ({
    facts: Object.fromEntries([...new Set([...Object.keys(facts), ...Object.keys(artists)])].map(uri => [uri, {
      ...facts[uri], ...(artists[uri] ? { artistUris: artists[uri].artists.map(artist => artist.uri) } : {}),
    }])),
    playlists: Object.fromEntries(Object.entries(playlists).map(([uri, entry]) => [uri,
      entry.status === "loaded" ? new Set(entry.uris) : undefined])),
    albums: Object.fromEntries(Object.entries(albums).map(([uri, entry]) => [uri,
      entry.status === "loaded" ? new Set(entry.tracks.map(t => t.uri)) : undefined])),
  }), [facts, artists, playlists, albums]);
}

/** Runs on saved songs as ordinary metadata arrives; never fetches missing details. */
export function useAutomaticTags(data: TagDataStructure, ready: boolean, apply: (updates: BatchTagUpdate[]) => Promise<void>) {
  const rules = useSyncExternalStore(subscribeRules, readRules);
  const context = useRuleContext();
  const seen = useRef(new Map<string, string>());
  const busy = useRef(false);
  const [revision, setRevision] = useState(0);
  const latest = useRef({ data, context, rules, ready, apply });
  latest.current = { data, context, rules, ready, apply };
  const account = getTagifyDatabaseName();
  useEffect(() => { seen.current.clear(); }, [account]);
  useEffect(() => {
    if (!ready || busy.current || !rules.some(r => r.enabled)) return;
    const timer = setTimeout(async () => {
      const current = latest.current;
      if (!current.ready || account !== getTagifyDatabaseName() || busy.current) return;
      const updates: BatchTagUpdate[] = [];
      const marks: Array<[string, string]> = [];
      for (const rule of current.rules.filter(r => r.enabled)) {
        const candidateData = ruleCandidates(rule, current.data, current.context);
        const plan = planRule(rule, current.data, current.context);
        const changesByUri = new Map(plan.updates.map(update => [update.trackUri, update]));
        for (const uri of Object.keys(candidateData.tracks)) {
          if (!current.data.tracks[uri] && (!current.context.facts[uri]?.name || !current.context.facts[uri]?.artists)) continue;
          const match = ruleMatch(rule, uri, candidateData, current.context);
          if (match === null || match === "outside") continue;
          const update = changesByUri.get(uri);
          const key = `${rule.id}:${uri}`;
          // Manual tag edits and Undo must not immediately retrigger automation.
          const { durationMs, albumUri, artistUris } = current.context.facts[uri] || {};
          const signature = JSON.stringify([rule, { durationMs, albumUri, artistUris },
            candidateData.tracks[uri].albumUri, candidateData.tracks[uri].bpm,
            rule.scopes.map(scope => current.context.playlists[scope]?.has(uri)),
          ]);
          if (seen.current.get(key) !== signature) {
            if (update) { updates.push(update); marks.push([key, signature]); }
            else seen.current.set(key, signature);
          }
        }
      }
      if (!updates.length) return;
      busy.current = true;
      try { await current.apply(updates); if (account === getTagifyDatabaseName()) marks.forEach(([key, value]) => seen.current.set(key, value)); }
      catch (error) {
        console.error("Automatic Tagify rule save:", error);
        if (account === getTagifyDatabaseName()) {
          try { pauseRules(current.rules.filter(r => r.enabled).map(r => r.id)); } catch { /* Still suppress retries this session. */ }
          marks.forEach(([key, value]) => seen.current.set(key, value));
          Spicetify.showNotification("Automatic tags paused because your changes couldn’t be saved. Check your rules and try again.", true);
        }
      } finally { busy.current = false; setRevision(value => value + 1); }
    }, 500);
    return () => clearTimeout(timer);
  }, [account, context, data, ready, rules, revision]);
}
