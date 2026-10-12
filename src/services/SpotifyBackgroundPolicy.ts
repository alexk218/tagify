import { spotifyLocalPause } from "@/utils/spotifyRequestFailure";
import { requestFingerprint } from "@/utils/spotifyRequestAccounting";

const HOUR = 60 * 60_000;
type Entry = { id: number; at: number };
type State = { attempts: Record<string, Entry[]>; throttledAt: number; strikes: number; until: number };
type StorageLike = Pick<Storage, "getItem" | "setItem">;
const shared = globalThis as typeof globalThis & { __tagifyBackgroundPolicyV1?: Map<string, State> };
const memory = shared.__tagifyBackgroundPolicyV1 ??= new Map<string, State>();
const storage = (): StorageLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const accountKey = () => typeof Spicetify === "undefined" ? "current" : Spicetify.Platform?.username ?? (Spicetify.Platform as any)?.UserAPI?._user?.username ?? "current";

/** Bounded, account-specific reservations survive reloads; manual operations do not consume them. */
export class SpotifyBackgroundPolicy {
  constructor(private getStorage = storage, private getAccount = accountKey) {}
  private key() { return `tagify:background-work:v1:${this.getAccount()}`; }
  private read(): State {
    const key = this.key(), now = Date.now();
    let state = memory.get(key) ?? { attempts: {}, throttledAt: 0, strikes: 0, until: 0 };
    try {
      const parsed = memory.has(key) ? null : JSON.parse(this.getStorage()?.getItem(key) ?? "null");
      if (parsed && typeof parsed.attempts === "object" && parsed.attempts && Number.isFinite(parsed.until) && Number.isFinite(parsed.throttledAt) && Number.isFinite(parsed.strikes)) state = parsed;
    } catch { /* In-memory protection remains available. */ }
    state.attempts = Object.fromEntries(Object.entries(state.attempts).slice(0, 16).map(([name, entries]) => [name,
      Array.isArray(entries) ? entries.filter(entry => entry && Number.isFinite(entry.id) && Number.isFinite(entry.at) && entry.at <= now && now - entry.at < HOUR).slice(-200) : [],
    ]));
    if (now - state.throttledAt >= HOUR || state.throttledAt > now) { state.strikes = 0; state.until = 0; }
    state.until = Math.min(state.until, now + HOUR);
    memory.set(key, state);
    return state;
  }
  private save(state: State) {
    memory.set(this.key(), state);
    try { this.getStorage()?.setItem(this.key(), JSON.stringify(state)); } catch { /* Best effort on full disks. */ }
  }
  reserve(feature: string, identity: string, limit: number): boolean {
    const state = this.read(), entries = state.attempts[feature] ?? [], id = requestFingerprint(identity);
    if (state.until > Date.now() || entries.length >= limit || entries.some(entry => entry.id === id)) return false;
    entries.push({ id, at: Date.now() }); state.attempts[feature] = entries; this.save(state); return true;
  }
  reservationRetryAt(feature: string, identity: string, limit: number): number {
    const state = this.read(), entries = state.attempts[feature] ?? [], id = requestFingerprint(identity);
    const same = entries.find(entry => entry.id === id);
    return Math.max(Date.now(), state.until, same ? same.at + HOUR : 0,
      entries.length >= limit ? Math.min(...entries.map(entry => entry.at)) + HOUR : 0);
  }
  throttled(retryAfterMs: number): void {
    const state = this.read();
    // Count actual responses, not each consumer of a shared request.
    state.strikes = Math.min(6, state.strikes + 1); state.throttledAt = Date.now();
    state.until = Math.max(state.until, Date.now() + Math.max(retryAfterMs, Math.min(30 * 60_000, 120_000 * 2 ** (state.strikes - 1))));
    this.save(state);
  }
  retryAt(): number { return this.read().until; }
  assertAvailable(): void {
    const until = this.read().until;
    if (until > Date.now()) throw spotifyLocalPause((until - Date.now()) / 1000);
  }
}
export const spotifyBackgroundPolicy = new SpotifyBackgroundPolicy();
