// A catalog filler's lookup lanes (now playing, Spotify search) poll Community every 15 seconds. When
// Community announces each new request on the filler's library channel, it adds `idlePollMaxMs` to the
// lane's GET answer: while the desktop is listening for that announcement and keeps finding nothing,
// it may stretch its polls up to this long. Community keeps the value below how long it still counts
// the filler as online (two minutes today), so stretching never makes the filler look offline.
// Absent (older Communities, or a lane that announces nothing) means poll every 15 seconds.
export const MIN_LOOKUP_IDLE_POLL_MS = 15_000;
export const MAX_LOOKUP_IDLE_POLL_MS = 30 * 60_000;

/** The GET answer's `idlePollMaxMs`, or undefined when absent or out of range (never guessed at). */
export function parseLookupIdlePollMaxMs(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= MIN_LOOKUP_IDLE_POLL_MS && (value as number) <= MAX_LOOKUP_IDLE_POLL_MS
    ? value as number : undefined;
}
