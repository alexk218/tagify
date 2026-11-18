/**
 * Onboarding preview: lets the Tagify team walk through first-run onboarding as a brand-new user
 * without touching their real library.
 *
 * While the preview is on, every bundle (the app and each extension) runs inside a sandbox:
 * - every `tagify:` localStorage key reads and writes a separate preview copy, so the real
 *   settings, prompt flags and Community connection are never read back or changed;
 * - the tag library opens a separate, empty IndexedDB database (see getTagifyDatabaseName);
 * - requests to Tagify Community and PostHog are answered locally: Community's usage endpoint as a
 *   brand-new account, product analytics dropped, and every other Community write refused;
 * - Spotify writes (playlists) are refused in spotifyWrite.
 *
 * The flag itself lives outside the `tagify:` namespace so the sandbox never redirects it.
 * Install the sandbox first in every bundle (`./installSandbox`), before any module reads storage.
 */

export const ONBOARDING_PREVIEW_FLAG_KEY = "tagify-onboarding-preview:v1";
/** Preview copies of `tagify:` keys live under this prefix. */
export const ONBOARDING_PREVIEW_STORAGE_PREFIX = "tagify-onboarding-preview:";
export const ONBOARDING_PREVIEW_DATABASE_PREFIX = "tagify-onboarding-preview-db";
const REDIRECTED_KEY_PREFIX = "tagify:";
const INSTALLED = Symbol.for("tagify.onboardingPreview.installed");

const COMMUNITY_HOST = /(^|\.)tagify\.fm$/;
const SUPABASE_HOST = /\.supabase\.co$/;
const POSTHOG_HOST = /(^|\.)posthog\.com$/;
const USAGE_PATH = "/api/v1/tagify-usage";

export class OnboardingPreviewBlockedError extends Error {
  constructor(what: string) {
    super(`${what} isn't saved in the onboarding preview. Your real library is unchanged.`);
    this.name = "OnboardingPreviewBlockedError";
  }
}

type StorageMethods = Pick<Storage, "getItem" | "setItem" | "removeItem">;
interface SandboxGlobal { [INSTALLED]?: { original: StorageMethods; target: StorageMethods } }

function originalStorage(): StorageMethods | null {
  const installed = (globalThis as SandboxGlobal)[INSTALLED];
  return installed?.original ?? null;
}

function rawGetItem(key: string): string | null {
  try {
    const original = originalStorage();
    return original ? original.getItem.call(localStorage, key) : localStorage.getItem(key);
  } catch { return null; }
}

const FLAG_ON = "on";
/** Set by "start": the next page load clears the previous preview before anything reads it. */
const FLAG_FRESH = "fresh";

/**
 * True only when this page runs inside the sandbox. A stored flag alone isn't enough: if the
 * sandbox didn't install (for example an older Tagify build loaded), Tagify runs normally rather
 * than mixing real settings with the preview library.
 */
export function isOnboardingPreviewActive(): boolean {
  if (!originalStorage()) return false;
  const flag = rawGetItem(ONBOARDING_PREVIEW_FLAG_KEY);
  return flag === FLAG_ON || flag === FLAG_FRESH;
}

export function previewStorageKey(key: string): string {
  return key.startsWith(REDIRECTED_KEY_PREFIX) ? `${ONBOARDING_PREVIEW_STORAGE_PREFIX}${key}` : key;
}

/** The name of a Tagify IndexedDB database in the current mode. */
export function onboardingPreviewDatabaseName(name: string): string {
  return isOnboardingPreviewActive() ? `${ONBOARDING_PREVIEW_DATABASE_PREFIX}:${name}` : name;
}

export function assertNotInOnboardingPreview(what: string): void {
  if (isOnboardingPreviewActive()) throw new OnboardingPreviewBlockedError(what);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new URL(raw, globalThis.location?.href);
  } catch { return null; }
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  try {
    if (typeof init?.body === "string") return JSON.parse(init.body);
    if (typeof Request !== "undefined" && input instanceof Request) return await input.clone().json();
  } catch { /* An unreadable body is answered as empty. */ }
  return null;
}

/**
 * Answers a Tagify request locally when the preview must not reach the real service.
 * Returns null when the request may go out unchanged (Spotify, GitHub, Community reads).
 */
export async function previewResponseFor(input: RequestInfo | URL, init?: RequestInit): Promise<Response | null> {
  const url = requestUrl(input);
  if (!url) return null;
  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  if (POSTHOG_HOST.test(url.hostname)) return jsonResponse({ status: 1 });
  const community = COMMUNITY_HOST.test(url.hostname) || SUPABASE_HOST.test(url.hostname);
  if (!community) return null;
  if (url.pathname === USAGE_PATH) {
    // Community remembers prompts per Spotify account; the preview answers as an account that has
    // seen only what this preview has shown, and records nothing.
    const body = await requestBody(input, init) as { promptHistory?: Record<string, unknown> } | null;
    const sent = body?.promptHistory ?? {};
    return jsonResponse({
      ok: true,
      promptHistory: {
        mobileTaggingIntroSeen: sent.mobileTaggingIntroSeen === true,
        discoverySurveyDismissed: sent.discoverySurveyDismissed === true,
      },
    });
  }
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  return jsonResponse({ error: "onboarding_preview", message: "Not sent during the onboarding preview." }, 503);
}

/**
 * Turns the sandbox on for this page when the preview flag is set. Safe to call from every bundle;
 * only the first call patches anything.
 */
export function installOnboardingPreviewSandbox(target: typeof globalThis = globalThis): void {
  const global = target as typeof globalThis & SandboxGlobal;
  if (global[INSTALLED]) return;
  let storage: Storage;
  try { storage = target.localStorage; } catch { return; }
  if (!storage) return;
  let flag: string | null = null;
  try { flag = storage.getItem(ONBOARDING_PREVIEW_FLAG_KEY); } catch { return; }
  if (flag !== FLAG_ON && flag !== FLAG_FRESH) return;

  // Spotify's page keeps the methods on Storage.prototype; a stand-in storage (tests) keeps its own.
  const proto: StorageMethods = typeof Storage !== "undefined" && storage instanceof Storage
    ? Storage.prototype
    : storage;
  const original: StorageMethods = { getItem: proto.getItem, setItem: proto.setItem, removeItem: proto.removeItem };
  global[INSTALLED] = { original, target: proto };
  if (flag === FLAG_FRESH) {
    clearPreviewStorage(storage, original);
    // Queued before any bundle opens these databases, so the preview starts empty.
    for (const name of PREVIEW_DATABASES) deleteDatabase(onboardingPreviewDatabaseName(name));
    original.setItem.call(storage, ONBOARDING_PREVIEW_FLAG_KEY, FLAG_ON);
  }
  const redirect = (self: Storage, key: unknown) =>
    self === storage && typeof key === "string" ? previewStorageKey(key) : key as string;
  proto.getItem = function getItem(this: Storage, key: string) { return original.getItem.call(this, redirect(this, key)); };
  proto.setItem = function setItem(this: Storage, key: string, value: string) { original.setItem.call(this, redirect(this, key), value); };
  proto.removeItem = function removeItem(this: Storage, key: string) { original.removeItem.call(this, redirect(this, key)); };

  const realFetch = target.fetch?.bind(target);
  if (realFetch) {
    target.fetch = async function previewFetch(input: RequestInfo | URL, init?: RequestInit) {
      const answer = await previewResponseFor(input, init);
      return answer ?? realFetch(input, init);
    } as typeof fetch;
  }
}

/** Every Tagify IndexedDB database the preview gets its own copy of. */
const PREVIEW_DATABASES = ["tagify-db", "tagify-tagged-by-others"] as const;

function deleteDatabase(name: string): void {
  try { globalThis.indexedDB?.deleteDatabase(name); } catch { /* Opened again empty or as left. */ }
}

function clearPreviewStorage(storage: Storage, original: StorageMethods): void {
  const keys: string[] = [];
  try {
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(ONBOARDING_PREVIEW_STORAGE_PREFIX) && key !== ONBOARDING_PREVIEW_FLAG_KEY) keys.push(key);
    }
    for (const key of keys) original.removeItem.call(storage, key);
  } catch { /* Leftover preview keys are only ever read inside a preview. */ }
}

function reloadPage(): void {
  globalThis.location?.reload();
}

/**
 * Starts a fresh preview and reloads Spotify's page into it. Also used for "Start over": the
 * previous preview's data is cleared as the page loads.
 */
export function startOnboardingPreview(reload: () => void = reloadPage): void {
  const original = originalStorage();
  if (original) original.setItem.call(localStorage, ONBOARDING_PREVIEW_FLAG_KEY, FLAG_FRESH);
  else localStorage.setItem(ONBOARDING_PREVIEW_FLAG_KEY, FLAG_FRESH);
  reload();
}

/**
 * Leaves the preview and reloads into the real library, which the preview never opened. The
 * preview's own data stays until the next preview starts.
 */
export function exitOnboardingPreview(reload: () => void = reloadPage): void {
  const original = originalStorage();
  if (original) original.removeItem.call(localStorage, ONBOARDING_PREVIEW_FLAG_KEY);
  else localStorage.removeItem(ONBOARDING_PREVIEW_FLAG_KEY);
  reload();
}
