import type { RuleFacts } from "./rules";
import { getSpotifyRetryAfterMs } from "@/utils/spotifyRateLimit";
const KEY = "tagify:publicTrackRuleFacts:v1";
let snapshot: Readonly<Record<string, RuleFacts>> | undefined;
let entriesByUri: Map<string, RuleFacts> | undefined;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
export function readRuleFacts() {
  if (!entriesByUri) {
    entriesByUri = new Map();
    try {
      const value = JSON.parse(localStorage.getItem(KEY) || "{}");
      entriesByUri = new Map(Object.entries(value).slice(-10_000).flatMap(([uri, raw]) => {
        const facts = raw as RuleFacts;
        return /^spotify:(track|local):/.test(uri) && facts && Number.isFinite(facts.durationMs) && facts.durationMs! > 0
          ? [[uri, { durationMs: facts.durationMs, ...(typeof facts.albumUri === "string" ? { albumUri: facts.albumUri } : {}) }]] : [];
      }));
    } catch { /* Public details can be rebuilt from ordinary Spotify reads. */ }
  }
  snapshot ??= Object.fromEntries(entriesByUri);
  return snapshot;
}
/** Only uses metadata already returned to Tagify. Never starts an API request. */
export function rememberRuleFacts(uri: string, facts: RuleFacts) {
  if (!/^spotify:(track|local):/.test(uri)) return;
  if (!entriesByUri) readRuleFacts();
  const previous = entriesByUri!.get(uri);
  const durationMs = Number.isFinite(facts.durationMs) && facts.durationMs! > 0 ? facts.durationMs : previous?.durationMs;
  if (!durationMs && !facts.name) return;
  const next = { durationMs, albumUri: facts.albumUri || previous?.albumUri,
    name: facts.name || previous?.name, artists: facts.artists || previous?.artists };
  if (JSON.stringify(previous) === JSON.stringify(next)) return;
  entriesByUri!.set(uri, next);
  if (entriesByUri!.size > 10_000) entriesByUri!.delete(entriesByUri!.keys().next().value!);
  snapshot = undefined;
  if (!timer) timer = setTimeout(() => {
    timer = undefined;
    // Keep a bounded device cache. Private playlist memberships are not persisted.
    // Display names stay in memory; saved annotations carry them after a rule adds a song.
    const entries = Object.entries(readRuleFacts()).slice(-10_000).map(([uri, facts]) => [uri, { durationMs: facts.durationMs, albumUri: facts.albumUri }]);
    try { localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* Session cache still works. */ }
    listeners.forEach(l => l());
  }, 250);
}
export function subscribeRuleFacts(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const PAUSE_KEY = "tagify:ruleDetailChecksPausedUntil";
let checking = false;
const failed = new Set<string>();
/** One user-controlled queue across dialogs, stopping at the first unavailable result. */
export async function checkRuleDetails(uris: string[], shouldContinue: () => boolean, onProgress: (count: number) => void, requireNamesFor = new Set<string>()) {
  if (checking) throw new Error("Song details are already being checked. Wait for that check to finish.");
  let pausedUntil = 0;
  try { pausedUntil = Number(localStorage.getItem(PAUSE_KEY)); } catch { /* Optional device cooldown. */ }
  if (pausedUntil > Date.now()) throw new Error("Spotify checks are paused for a moment. Please try again later.");
  checking = true;
  let count = 0;
  try {
    const { spotifyService } = await import("@/services/SpotifyService");
    for (const uri of [...new Set(uris)].filter(uri => uri.startsWith("spotify:track:") && (!readRuleFacts()[uri]?.durationMs || (requireNamesFor.has(uri) && !readRuleFacts()[uri]?.name))).sort((a, b) => Number(failed.has(a)) - Number(failed.has(b))).slice(0, 50)) {
      if (!shouldContinue()) break;
      let details;
      try { details = await spotifyService.getTrack(uri); } catch (error) { failed.add(uri); throw error; }
      if (!details || !details.duration_ms) { failed.add(uri); throw new Error("Spotify couldn’t provide more details. Checks stopped; your saved results are safe. Try again later."); }
      failed.delete(uri);
      onProgress(++count);
      if (!shouldContinue()) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    return count;
  } catch (error) {
    const until = Date.now() + Math.max(60_000, getSpotifyRetryAfterMs(error) ?? 0);
    try { localStorage.setItem(PAUSE_KEY, String(until)); } catch { /* Session queue is still bounded. */ }
    console.error("Automatic tag song-detail check:", error);
    throw new Error("Spotify couldn’t provide more details. Checks paused; your saved results are safe. Try again later.");
  } finally { checking = false; }
}
