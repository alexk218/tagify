type Rgb = [number, number, number];

function parseColor(color: string): Rgb | null {
  const hex = color.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4].map((offset) => parseInt(full.slice(offset, offset + 2), 16)) as Rgb;
  }
  const rgb = color.trim().match(/^rgba?\(([^)]+)\)$/i)?.[1];
  if (!rgb) return null;
  const channels = rgb.split(/[\s,/]+/).map(Number);
  if (channels.length !== 3 && channels.length !== 4) return null;
  if (channels.length === 4 && channels[3] !== 1) return null;
  return channels.slice(0, 3).every((value) => Number.isFinite(value) && value >= 0 && value <= 255)
    ? channels.slice(0, 3) as Rgb
    : null;
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function contrast(background: Rgb, foreground: Rgb): number {
  const values = [luminance(background), luminance(foreground)].sort((a, b) => a - b);
  return (values[1] + 0.05) / (values[0] + 0.05);
}

/** Return an override only when the theme's inactive controls nearly disappear. */
export function getRatingControlColor(
  backgroundColor: string,
  mutedColor: string,
  subtextColor: string,
  textColor: string,
): string | null {
  const background = parseColor(backgroundColor);
  const muted = parseColor(mutedColor);
  // Default Spotify's subtle gray controls remain exactly as they are.
  if (!background || !muted || contrast(background, muted) >= 1.5) return null;

  for (const color of [subtextColor, textColor]) {
    const foreground = parseColor(color);
    if (foreground && contrast(background, foreground) >= 3) return color;
  }
  return contrast(background, [255, 255, 255]) >= contrast(background, [0, 0, 0])
    ? "#ffffff"
    : "#000000";
}
