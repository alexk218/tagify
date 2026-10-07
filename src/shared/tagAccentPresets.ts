export const TAGIFY_PRESET_ACCENTS = {
  blue: "#5b8cff",
  teal: "#2dd4bf",
  green: "#4ade80",
  amber: "#f59e0b",
  rose: "#fb7185",
  slate: "#94a3b8",
} as const;

export type TagifyPresetAccentId = keyof typeof TAGIFY_PRESET_ACCENTS;

export function isTagifyPresetAccentId(
  value: unknown,
): value is TagifyPresetAccentId {
  return typeof value === "string" && value in TAGIFY_PRESET_ACCENTS;
}

export function resolveTagifyPresetAccent(
  value: unknown,
): string | null {
  return isTagifyPresetAccentId(value) ? TAGIFY_PRESET_ACCENTS[value] : null;
}
