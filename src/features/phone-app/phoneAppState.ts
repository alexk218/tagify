import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * What this computer remembers about the phone apps button. Stored on this device only; nothing
 * here leaves it.
 */
export interface PhoneAppState {
  /** The panel was opened at least once: the "new" dot is gone. */
  opened?: boolean;
  /** "Don't show this button again", or the Settings switch turned off. */
  hidden?: boolean;
  /** The Settings switch turned on: shown even with optional buttons off. */
  pinned?: boolean;
  /** When the button first showed to someone who had hidden the optional buttons. */
  quietSince?: number;
  /** "Notify me when it's out" for the Android app. */
  androidNotify?: boolean;
  /** The Android release notice was answered and never shows again. */
  androidNoticeDone?: boolean;
}

export const PHONE_APP_STATE_KEY = "tagify:phone-app:v1";
/** How long the button shows to people who hid the optional buttons, unless they open it first. */
export const QUIET_MENU_GRACE_MS = 14 * 24 * 60 * 60 * 1000;

const CHANGED_EVENT = "tagify:phoneAppStateChanged";

let cached: { raw: string | null; state: PhoneAppState } = { raw: null, state: {} };

export function readPhoneAppState(): PhoneAppState {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(PHONE_APP_STATE_KEY);
  } catch {
    return cached.state;
  }
  if (raw === cached.raw) return cached.state;
  let state: PhoneAppState = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") state = parsed as PhoneAppState;
  } catch { /* A damaged value starts over. */ }
  cached = { raw, state };
  return state;
}

export function updatePhoneAppState(change: Partial<PhoneAppState>): void {
  const next = { ...readPhoneAppState(), ...change };
  const raw = JSON.stringify(next);
  cached = { raw, state: next };
  try {
    window.localStorage.setItem(PHONE_APP_STATE_KEY, raw);
  } catch { /* Kept for this session when storage is unavailable. */ }
  window.dispatchEvent(new Event(CHANGED_EVENT));
}

/**
 * Whether the top menu shows the phone apps button. With optional buttons on it is one of them;
 * with them off it still shows until opened once or for two weeks, whichever comes first.
 */
export function isPhoneButtonVisible(state: PhoneAppState, optionalButtons: boolean, now: number): boolean {
  if (state.hidden) return false;
  if (state.pinned || optionalButtons) return true;
  if (state.opened) return false;
  return state.quietSince === undefined || now - state.quietSince < QUIET_MENU_GRACE_MS;
}

const subscribe = (onChange: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === PHONE_APP_STATE_KEY) onChange();
  };
  window.addEventListener(CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
};

export function usePhoneAppState(): PhoneAppState {
  return useSyncExternalStore(subscribe, readPhoneAppState, readPhoneAppState);
}

export function usePhoneAppButton(optionalButtons: boolean) {
  const state = usePhoneAppState();
  const visible = isPhoneButtonVisible(state, optionalButtons, Date.now());
  const quiet = visible && !optionalButtons && !state.pinned;

  // The two weeks start the first time the button shows in a quiet menu.
  useEffect(() => {
    if (quiet && state.quietSince === undefined) updatePhoneAppState({ quietSince: Date.now() });
  }, [quiet, state.quietSince]);

  const markOpened = useCallback(() => {
    if (!readPhoneAppState().opened) updatePhoneAppState({ opened: true });
  }, []);
  const hide = useCallback(() => updatePhoneAppState({ hidden: true, pinned: false }), []);
  const setShown = useCallback((shown: boolean) => updatePhoneAppState({ hidden: !shown, pinned: shown }), []);

  return { visible, showDot: visible && !state.opened, markOpened, hide, setShown };
}
