/**
 * The To Tag icon: the Tagify logo (the tag) with a small plus, or a small
 * check once the song is on the list. Shared by the Spotify right-click menu,
 * the song row icon and the Track Details button.
 */
export const TAGIFY_LOGO_PATH =
  "M21.41,11.58L12.41,2.58C12.04,2.21 11.53,2 11,2H4C2.9,2 2,2.9 2,4V11C2,11.53 2.21,12.04 2.59,12.42L11.59,21.42C11.96,21.79 12.47,22 13,22C13.53,22 14.04,21.79 14.41,21.42L21.41,14.42C21.79,14.04 22,13.53 22,13C22,12.47 21.79,11.96 21.41,11.58M5.5,7C4.67,7 4,6.33 4,5.5C4,4.67 4.67,4 5.5,4C6.33,4 7,4.67 7,5.5C7,6.33 6.33,7 5.5,7Z";
export const TO_TAG_PLUS_PATH = "M18.5 13h2v3.5H24v2h-3.5V22h-2v-3.5H15v-2h3.5V13Z";
export const TO_TAG_CHECK_PATH = "m14.6 18 1.4-1.4 2.1 2.1 4.5-4.5 1.4 1.4-5.9 5.9-3.5-3.5Z";

export function toTagIconSvg(onList: boolean, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path transform="scale(0.75)" d="${TAGIFY_LOGO_PATH}"/><path d="${onList ? TO_TAG_CHECK_PATH : TO_TAG_PLUS_PATH}"/></svg>`;
}
