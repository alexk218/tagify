function trimIdentity(value?: string | null): string {
  return (value || "").trim();
}

function extractFromSpotifyUri(value: string): string {
  if (!value.toLowerCase().startsWith("spotify:user:")) {
    return value;
  }

  return value.split(":").pop() || value;
}

function extractFromSpotifyUrl(value: string): string {
  const lowerValue = value.toLowerCase();
  const userSegmentIndex = lowerValue.indexOf("/user/");
  if (userSegmentIndex === -1) {
    return value;
  }

  const afterUserSegment = value.slice(userSegmentIndex + "/user/".length);
  const sanitized = afterUserSegment.split(/[/?#]/)[0];
  return sanitized || value;
}

export function normalizeSpotifyUserIdentity(value?: string | null): string {
  const trimmed = trimIdentity(value);
  if (!trimmed) {
    return "";
  }

  return extractFromSpotifyUrl(extractFromSpotifyUri(trimmed)).toLowerCase();
}

