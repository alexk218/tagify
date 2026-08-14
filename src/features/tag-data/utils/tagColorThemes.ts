import type { CustomTagAccent, PresetTagAccentId, TagColorTheme, TagTaxonomy } from "@/types/tagData";
import { TAG_ACCENT_PRESET_OPTIONS, getTagAccentTokens } from "./tagAccent";

export const DEFAULT_COLOR_THEME_ID = "theme:default";
export const COLOR_LIBRARY_FORMAT = "tagify-colors";
export const COLOR_LIBRARY_VERSION = 1;

type ColorExport = { name: string; color: string };
export type ColorLibraryFile = {
  format: typeof COLOR_LIBRARY_FORMAT;
  version: typeof COLOR_LIBRARY_VERSION;
  themes: Array<{ name: string; colors: ColorExport[] }>;
  ungrouped: ColorExport[];
};

const legacyDefaultColors = TAG_ACCENT_PRESET_OPTIONS.map((option) => ({
  id: `custom:default-${option.value}` as const,
  presetId: option.value,
  name: option.label,
  color: getTagAccentTokens(option.value)?.dot ?? "#94a3b8",
}));

function isUnmodifiedLegacyDefaultColor(
  accent: TagTaxonomy["customAccentsById"][string] | undefined,
  legacyColor: (typeof legacyDefaultColors)[number],
): boolean {
  return Boolean(
    accent &&
    accent.name.trim().toLocaleLowerCase() === legacyColor.name.toLocaleLowerCase() &&
    accent.color.toLocaleLowerCase() === legacyColor.color.toLocaleLowerCase(),
  );
}

export type ColorLibrarySortMode = "custom" | "alphabetical" | "created" | "updated";

export function getOrderedColorThemes(taxonomy: Pick<TagTaxonomy, "colorThemesById" | "colorThemeOrder">, sortMode: ColorLibrarySortMode): TagColorTheme[] {
  const themesInDataOrder = Object.values(taxonomy.colorThemesById ?? {});
  const byName = (left: TagColorTheme, right: TagColorTheme) => left.name.localeCompare(right.name);
  if (sortMode === "alphabetical") return [...themesInDataOrder].sort(byName);
  if (sortMode === "created") return [...themesInDataOrder].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0) || byName(left, right));
  if (sortMode === "updated") return [...themesInDataOrder].sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0) || byName(left, right));
  const themesById = taxonomy.colorThemesById ?? {};
  const orderedIds = (taxonomy.colorThemeOrder ?? []).filter((id) => themesById[id]);
  const listed = new Set(orderedIds);
  return [...orderedIds.map((id) => themesById[id]), ...themesInDataOrder.filter((theme) => !listed.has(theme.id))];
}

export function getOrderedCustomColors(
  taxonomy: Pick<TagTaxonomy, "customAccentsById">,
  colorIds: readonly `custom:${string}`[],
  sortMode: ColorLibrarySortMode,
): CustomTagAccent[] {
  const colorsInCustomOrder = colorIds
    .map((id) => taxonomy.customAccentsById[id])
    .filter((color): color is CustomTagAccent => Boolean(color));
  const byName = (left: CustomTagAccent, right: CustomTagAccent) => left.name.localeCompare(right.name);
  if (sortMode === "alphabetical") return [...colorsInCustomOrder].sort(byName);
  if (sortMode === "created") return [...colorsInCustomOrder].sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0) || byName(left, right));
  if (sortMode === "updated") return [...colorsInCustomOrder].sort((left, right) => (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0) || byName(left, right));
  return colorsInCustomOrder;
}

export function normalizeColorLibrary(taxonomy: Partial<TagTaxonomy>): Pick<TagTaxonomy, "customAccentsById" | "colorThemesById" | "colorThemeOrder" | "ungroupedColorIds" | "tagsById"> {
  const accents = { ...(taxonomy.customAccentsById ?? {}) };
  const tagsById = Object.fromEntries(Object.entries(taxonomy.tagsById ?? {}).map(([id, tag]) => [id, { ...tag }]));
  const themes = { ...(taxonomy.colorThemesById ?? {}) };
  const legacyDefaultTheme = themes[DEFAULT_COLOR_THEME_ID];
  const migratedPresetIds = new Map<string, PresetTagAccentId>();

  legacyDefaultColors.forEach((legacyColor) => {
    const accent = accents[legacyColor.id];
    if (isUnmodifiedLegacyDefaultColor(accent, legacyColor)) {
      delete accents[legacyColor.id];
      migratedPresetIds.set(legacyColor.id, legacyColor.presetId);
    } else if (accent?.themeId === DEFAULT_COLOR_THEME_ID) {
      accents[legacyColor.id] = { ...accent, themeId: null };
    }
  });

  Object.values(tagsById).forEach((tag) => {
    const presetId = migratedPresetIds.get(tag.accentId ?? "");
    if (presetId) tag.accentId = presetId;
  });

  delete themes[DEFAULT_COLOR_THEME_ID];

  const assigned = new Set<string>();
  const colorThemesById = Object.fromEntries(
    Object.values(themes)
      .filter((theme): theme is TagColorTheme => Boolean(theme?.id && theme?.name))
      .map((theme) => {
        const colorIds = (theme.colorIds ?? []).filter((id) => accents[id] && !assigned.has(id));
        colorIds.forEach((id) => assigned.add(id));
        return [theme.id, { ...theme, colorIds, ...(typeof theme.createdAt === "number" ? { createdAt: theme.createdAt } : {}), ...(typeof theme.updatedAt === "number" ? { updatedAt: theme.updatedAt } : {}) }];
      }),
  );
  const requestedUngrouped = [
    ...(taxonomy.ungroupedColorIds ?? Object.keys(accents)),
    ...(legacyDefaultTheme?.colorIds ?? []),
  ];
  const ungroupedColorIds = requestedUngrouped.filter((id) => accents[id] && !assigned.has(id)) as `custom:${string}`[];
  Object.keys(accents).forEach((id) => {
    if (!assigned.has(id) && !ungroupedColorIds.includes(id as `custom:${string}`)) ungroupedColorIds.push(id as `custom:${string}`);
  });
  Object.values(colorThemesById).forEach((theme) => theme.colorIds.forEach((id) => { accents[id] = { ...accents[id], themeId: theme.id }; }));
  ungroupedColorIds.forEach((id) => { accents[id] = { ...accents[id], themeId: null }; });
  const colorThemeOrder = (taxonomy.colorThemeOrder ?? []).filter((id) => colorThemesById[id]);
  const orderedThemeIds = new Set(colorThemeOrder);
  Object.keys(colorThemesById).forEach((id) => {
    if (!orderedThemeIds.has(id)) colorThemeOrder.push(id);
  });
  return { customAccentsById: accents, colorThemesById, colorThemeOrder, ungroupedColorIds, tagsById };
}

function isColor(value: unknown): value is ColorExport {
  return Boolean(value && typeof value === "object" && typeof (value as ColorExport).name === "string" && (value as ColorExport).name.trim() && /^#[0-9a-f]{6}$/i.test((value as ColorExport).color));
}

export function parseColorLibrary(value: unknown): ColorLibraryFile | null {
  if (!value || typeof value !== "object") return null;
  const file = value as ColorLibraryFile;
  if (file.format !== COLOR_LIBRARY_FORMAT || file.version !== COLOR_LIBRARY_VERSION || !Array.isArray(file.themes) || !Array.isArray(file.ungrouped)) return null;
  if (!file.ungrouped.every(isColor) || !file.themes.every((theme) => theme && typeof theme.name === "string" && theme.name.trim() && Array.isArray(theme.colors) && theme.colors.every(isColor))) return null;
  return file;
}

export function serializeColorLibrary(taxonomy: TagTaxonomy, themeId?: string): ColorLibraryFile {
  const toColor = (id: string): ColorExport | null => {
    const accent = taxonomy.customAccentsById[id];
    return accent ? { name: accent.name, color: accent.color } : null;
  };
  const themes = Object.values(taxonomy.colorThemesById)
    .filter((theme) => !themeId || theme.id === themeId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((theme) => ({ name: theme.name, colors: theme.colorIds.map(toColor).filter((color): color is ColorExport => Boolean(color)) }));
  return { format: COLOR_LIBRARY_FORMAT, version: COLOR_LIBRARY_VERSION, themes, ungrouped: themeId ? [] : taxonomy.ungroupedColorIds.map(toColor).filter((color): color is ColorExport => Boolean(color)) };
}

export function uniqueImportedName(name: string, used: Set<string>): string {
  let candidate = name.trim().slice(0, 32);
  let suffix = 1;
  while (used.has(candidate.toLocaleLowerCase())) candidate = `${name.trim().slice(0, Math.max(1, 28 - String(suffix).length))} (${suffix++})`;
  used.add(candidate.toLocaleLowerCase());
  return candidate;
}
