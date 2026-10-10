import { MAX_APP_STATE_DOCUMENT_BYTES } from "@tagify/sync-contracts";
import { durableStateStoredByteLength, readLocalDurableAppState } from "@/services/sync/DurableAppState";
import { normalizeRules, type AutomaticTagRule } from "./rules";
export const AUTOMATIC_TAG_RULES_KEY = "tagify:automaticTagRules";
const EVENT = "tagify:automaticTagRulesChanged";
let cachedRaw: string | null | undefined;
let cached: AutomaticTagRule[] = [];
export function readRules(): AutomaticTagRule[] {
  let raw: string | null;
  try { raw = localStorage.getItem(AUTOMATIC_TAG_RULES_KEY); } catch { return cached; }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try { cached = normalizeRules(raw ? JSON.parse(raw) : []); } catch { cached = []; }
  }
  return cached;
}
export function writeRules(rules: AutomaticTagRule[]) {
  const normalized = normalizeRules(rules);
  if (normalized.length !== rules.length) throw new Error("Check the rule name, ranges, and selected tags before saving.");
  const preferences = { ...readLocalDurableAppState().preferences as Record<string, unknown>, [AUTOMATIC_TAG_RULES_KEY]: normalized };
  if (durableStateStoredByteLength(normalized) > MAX_APP_STATE_DOCUMENT_BYTES / 4 || durableStateStoredByteLength(preferences) > MAX_APP_STATE_DOCUMENT_BYTES)
    throw new Error("Your saved settings are full. Remove a rule or tag combination before saving.");
  try { localStorage.setItem(AUTOMATIC_TAG_RULES_KEY, JSON.stringify(normalized)); }
  catch { throw new Error("Your rules couldn’t be saved on this device. Please try again."); }
  window.dispatchEvent(new Event(EVENT));
  window.dispatchEvent(new Event("tagify:settingsChanged"));
  window.dispatchEvent(new Event("tagify:syncOutboxChanged"));
}
export function pauseRules(ids: string[]) {
  const rules = readRules();
  if (rules.some(r => r.enabled && ids.includes(r.id))) writeRules(rules.map(r => ids.includes(r.id) ? { ...r, enabled: false } : r));
}
export function subscribeRules(listener: () => void) {
  const storage = (e: StorageEvent) => { if (!e.key || e.key === AUTOMATIC_TAG_RULES_KEY) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener("tagify:durableStateRestored", listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("tagify:durableStateRestored", listener);
    window.removeEventListener("storage", storage);
  };
}
