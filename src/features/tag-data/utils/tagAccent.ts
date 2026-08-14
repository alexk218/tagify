import type { CSSProperties } from "react";
import type {
  CustomTagAccent,
  PresetTagAccentId,
  TagAccentId,
} from "@/types/tagData";

export interface TagAccentTokens {
  dot: string;
  border: string;
  tint: string;
  text: string;
}

export interface TagAccentOption {
  value: TagAccentId;
  label: string;
  isCustom: boolean;
}

export const TAG_ACCENT_PRESET_OPTIONS: Array<{
  value: PresetTagAccentId;
  label: string;
}> = [
  { value: "blue", label: "Blue" },
  { value: "teal", label: "Teal" },
  { value: "green", label: "Green" },
  { value: "amber", label: "Amber" },
  { value: "rose", label: "Rose" },
  { value: "slate", label: "Slate" },
];

export const TAG_ACCENT_OPTIONS = TAG_ACCENT_PRESET_OPTIONS;

const TAG_ACCENT_TOKENS: Record<PresetTagAccentId, TagAccentTokens> = {
  blue: {
    dot: "#5b8cff",
    border: "rgb(91 140 255 / 42%)",
    tint: "rgb(91 140 255 / 12%)",
    text: "#dce7ff",
  },
  teal: {
    dot: "#2dd4bf",
    border: "rgb(45 212 191 / 42%)",
    tint: "rgb(45 212 191 / 12%)",
    text: "#d7fffa",
  },
  green: {
    dot: "#4ade80",
    border: "rgb(74 222 128 / 42%)",
    tint: "rgb(74 222 128 / 12%)",
    text: "#e2ffe9",
  },
  amber: {
    dot: "#f59e0b",
    border: "rgb(245 158 11 / 42%)",
    tint: "rgb(245 158 11 / 12%)",
    text: "#fff0cf",
  },
  rose: {
    dot: "#fb7185",
    border: "rgb(251 113 133 / 42%)",
    tint: "rgb(251 113 133 / 12%)",
    text: "#ffe0e5",
  },
  slate: {
    dot: "#94a3b8",
    border: "rgb(148 163 184 / 42%)",
    tint: "rgb(148 163 184 / 12%)",
    text: "#edf2f8",
  },
};

function clampColorChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [hash, r, g, b] = trimmed;
    return `${hash}${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }

  return null;
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } {
  return {
    r: parseInt(hexColor.slice(1, 3), 16),
    g: parseInt(hexColor.slice(3, 5), 16),
    b: parseInt(hexColor.slice(5, 7), 16),
  };
}

function toRgbaString(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): string {
  return `rgb(${red} ${green} ${blue} / ${alpha})`;
}

function buildCustomAccentTokens(color: string): TagAccentTokens {
  const normalizedColor = normalizeHexColor(color) ?? "#94a3b8";
  const { r, g, b } = hexToRgb(normalizedColor);

  const borderRed = clampColorChannel(r + (255 - r) * 0.08);
  const borderGreen = clampColorChannel(g + (255 - g) * 0.08);
  const borderBlue = clampColorChannel(b + (255 - b) * 0.08);
  // Custom accents render inside darkened filled chips, so basing text on the
  // raw accent hex makes bright yellows incorrectly choose dark label text.
  const text = "#f8fbff";

  return {
    dot: normalizedColor,
    border: toRgbaString(borderRed, borderGreen, borderBlue, 0.42),
    tint: toRgbaString(r, g, b, 0.16),
    text,
  };
}

export function buildCustomTagAccentId(): `custom:${string}` {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `custom:${crypto.randomUUID()}`;
  }

  return `custom:${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isPresetTagAccentId(value: unknown): value is PresetTagAccentId {
  return TAG_ACCENT_PRESET_OPTIONS.some((option) => option.value === value);
}

export function isCustomTagAccentId(value: unknown): value is `custom:${string}` {
  return typeof value === "string" && value.startsWith("custom:");
}

export function isTagAccentId(
  value: unknown,
  customAccentsById: Record<string, CustomTagAccent> = {},
): value is TagAccentId {
  return (
    isPresetTagAccentId(value) ||
    (isCustomTagAccentId(value) && Boolean(customAccentsById[value]))
  );
}

export function normalizeTagAccentId(
  value: unknown,
  customAccentsById: Record<string, CustomTagAccent> = {},
): TagAccentId | null {
  return isTagAccentId(value, customAccentsById) ? value : null;
}

function normalizeCustomAccentName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 32);
}

export function normalizeCustomTagAccent(
  value: unknown,
): CustomTagAccent | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<CustomTagAccent>;
  if (!isCustomTagAccentId(candidate.id)) {
    return null;
  }

  const name = normalizeCustomAccentName(candidate.name);
  const color = normalizeHexColor(candidate.color ?? "");
  if (!name || !color) {
    return null;
  }

  return {
    id: candidate.id,
    name,
    color,
    ...(typeof candidate.createdAt === "number" ? { createdAt: candidate.createdAt } : {}),
    ...(typeof candidate.updatedAt === "number" ? { updatedAt: candidate.updatedAt } : {}),
  };
}

export function normalizeCustomTagAccents(
  value: unknown,
): Record<string, CustomTagAccent> {
  if (!value || typeof value !== "object") {
    return {};
  }

  const entries: Array<[string, CustomTagAccent]> = [];

  Object.entries(value as Record<string, unknown>).forEach(([accentId, accent]) => {
    const normalizedAccent = normalizeCustomTagAccent({
      ...(accent as Record<string, unknown>),
      id: accentId,
    });

    if (normalizedAccent) {
      entries.push([normalizedAccent.id, normalizedAccent]);
    }
  });

  return Object.fromEntries(entries);
}

export function getTagAccentOptions(
  customAccentsById: Record<string, CustomTagAccent> = {},
  includePresets = true,
): TagAccentOption[] {
  return [
    ...(includePresets ? TAG_ACCENT_PRESET_OPTIONS : []).map((option) => ({
      value: option.value,
      label: option.label,
      isCustom: false,
    })),
    ...Object.values(customAccentsById)
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((accent) => ({
        value: accent.id,
        label: accent.name,
        isCustom: true,
      })),
  ];
}

export function getTagAccentTokens(
  accentId: TagAccentId | null | undefined,
  customAccentsById: Record<string, CustomTagAccent> = {},
): TagAccentTokens | null {
  if (!accentId) {
    return null;
  }

  if (isPresetTagAccentId(accentId)) {
    return TAG_ACCENT_TOKENS[accentId] ?? null;
  }

  const customAccent = customAccentsById[accentId];
  if (!customAccent) {
    return null;
  }

  return buildCustomAccentTokens(customAccent.color);
}

export function buildTagAccentCssVars(
  accentId: TagAccentId | null | undefined,
  customAccentsById: Record<string, CustomTagAccent> = {},
): CSSProperties | undefined {
  const tokens = getTagAccentTokens(accentId, customAccentsById);
  if (!tokens) {
    return undefined;
  }

  return {
    "--tag-accent-dot": tokens.dot,
    "--tag-accent-border": tokens.border,
    "--tag-accent-tint": tokens.tint,
    "--tag-accent-text": tokens.text,
  } as CSSProperties;
}
