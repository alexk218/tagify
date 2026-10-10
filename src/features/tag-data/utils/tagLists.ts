import type { TagCategory, TagSubcategory } from "@/types/tagData";

export interface ListedTag { id: string; name: string; path: string }

export function listTags(categories: TagCategory[]): ListedTag[] {
  const result = new Map<string, ListedTag>();
  const visit = (node: TagCategory | TagSubcategory, path: string) => {
    node.tags?.forEach(tag => result.set(tag.id, { id: tag.id, name: tag.name, path: `${path} / ${tag.name}` }));
    node.subcategories?.forEach(child => visit(child, `${path} / ${child.name}`));
  };
  categories.forEach(category => visit(category, category.name));
  return [...result.values()];
}

/** Quoted names may contain commas; separators outside quotes split the list. */
export function parseTagList(raw: string): string[] {
  if (raw.length > 10_000) throw new Error("Paste a shorter list of tags (up to 10,000 characters).");
  let text = raw.trim();
  let values: string[];
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.every(item => typeof item === "string")) values = parsed;
      else throw new Error();
    } catch { values = splitList(text.replace(/^\[|\]$/g, "")); }
  } else {
    if (text.startsWith("{") && text.endsWith("}")) text = text.slice(1, -1);
    values = splitList(text);
  }
  const names = [...new Map(values.map(value => [value.trim().toLocaleLowerCase(), value.trim()])).values()].filter(Boolean);
  if (names.length > 100) throw new Error("Apply up to 100 different tags at a time.");
  return names;
}

function splitList(text: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { current += '"'; index += 1; }
      else quoted = !quoted;
    } else if (!quoted && /[,;\n\r]/.test(char)) { values.push(current); current = ""; }
    else current += char;
  }
  if (quoted) throw new Error("Close the quotation mark around your tag name.");
  values.push(current);
  return values;
}

export function matchTagList(names: string[], tags: ListedTag[]) {
  return names.map(name => ({ name, matches: tags.filter(tag =>
    tag.name.toLocaleLowerCase() === name.toLocaleLowerCase() || tag.path.toLocaleLowerCase() === name.toLocaleLowerCase()) }));
}
