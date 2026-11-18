// Spotify cover IDs start with a size code. Swapping it for the 64px code lets
// the track list load a ~3 KB thumbnail instead of the 300px or 640px original.
const SPOTIFY_COVER_SIZE_CODES = ["ab67616d0000b273", "ab67616d00001e02", "ab67616d00004851"];
const SMALL_COVER_SIZE_CODE = "ab67616d00004851";
const SPOTIFY_IMAGE_URI = /^spotify:image:([0-9a-f]+)$/i;
const SPOTIFY_IMAGE_URL = /^https:\/\/i\.scdn\.co\/image\/([0-9a-f]+)$/i;

export function toSmallSpotifyCover(url: string | null | undefined): string | null {
  if (!url) return null;
  const imageId = url.match(SPOTIFY_IMAGE_URI)?.[1] ?? url.match(SPOTIFY_IMAGE_URL)?.[1];
  if (!imageId) return url.startsWith("https://") ? url : null;
  const sizeCode = SPOTIFY_COVER_SIZE_CODES.find((code) => imageId.toLowerCase().startsWith(code));
  const smallId = sizeCode ? SMALL_COVER_SIZE_CODE + imageId.slice(sizeCode.length) : imageId;
  return `https://i.scdn.co/image/${smallId}`;
}
