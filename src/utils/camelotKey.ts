const CAMELOT_KEY_PATTERN = /^([1-9]|1[0-2])([ab])$/i;

export const CAMELOT_KEY_ORDER = [
  "1A",
  "2A",
  "3A",
  "4A",
  "5A",
  "6A",
  "7A",
  "8A",
  "9A",
  "10A",
  "11A",
  "12A",
  "1B",
  "2B",
  "3B",
  "4B",
  "5B",
  "6B",
  "7B",
  "8B",
  "9B",
  "10B",
  "11B",
  "12B",
] as const;

const CAMELOT_INDEX_MAP = new Map<string, number>(
  CAMELOT_KEY_ORDER.map((key, index) => [key, index]),
);

export function normalizeCamelotKey(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  const compact = value.replace(/\s+/g, "");
  const match = compact.match(CAMELOT_KEY_PATTERN);
  if (!match) {
    return null;
  }

  return `${match[1]}${match[2].toUpperCase()}`;
}

export function getCamelotKeyOrderIndex(
  value: string | null | undefined,
): number | null {
  const normalized = normalizeCamelotKey(value);
  if (!normalized) {
    return null;
  }

  const index = CAMELOT_INDEX_MAP.get(normalized);
  return index ?? null;
}

export function sortCamelotKeys(keys: Iterable<string>): string[] {
  const normalizedKeys = new Set<string>();

  for (const key of keys) {
    const normalized = normalizeCamelotKey(key);
    if (normalized) {
      normalizedKeys.add(normalized);
    }
  }

  return Array.from(normalizedKeys).sort((left, right) => {
    const leftIndex = getCamelotKeyOrderIndex(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex =
      getCamelotKeyOrderIndex(right) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

export function isCamelotKeyInRange(
  camelotKey: string | null | undefined,
  minFilter: string | null | undefined,
  maxFilter: string | null | undefined,
): boolean {
  const keyIndex = getCamelotKeyOrderIndex(camelotKey);
  const minIndex = getCamelotKeyOrderIndex(minFilter);
  const maxIndex = getCamelotKeyOrderIndex(maxFilter);

  const matchesMin =
    minIndex === null || (keyIndex !== null && keyIndex >= minIndex);
  const matchesMax =
    maxIndex === null || (keyIndex !== null && keyIndex <= maxIndex);

  return matchesMin && matchesMax;
}
