import type { SmartPlaylistFilterCriteria } from "../model/smartPlaylist.types";
import type { TagTaxonomy } from "@/types/tagData";
import { evaluateTagFilterFormula, getTagGroupFilterGroupId, normalizeTagFilterFormula, resolveTagGroupTagIds } from "@/utils/tagFilterGroups";

export interface TagChoice { add: string[]; remove: string[] }

/** Minimal alternatives that satisfy the formula. null requests manual selection for large formulas. */
export function smartPlaylistTagChoices(tagIds: string[], criteria: SmartPlaylistFilterCriteria, taxonomy: TagTaxonomy | null): TagChoice[] | null {
  const formula = normalizeTagFilterFormula({ clauses: criteria.includeTagClauses, connectors: criteria.clauseConnectors });
  if (evaluateTagFilterFormula(tagIds, formula, taxonomy)) return [{ add: [], remove: [] }];
  // "Any Genre" leaves the choice of tag to the person. "No Mood" removes the song's Mood tags.
  if (formula.clauses.some((clause) => clause.tagIds.some((id) => getTagGroupFilterGroupId(id) !== null))) return null;
  const removeTerms = (ids: string[]) => [...new Set(ids.flatMap((id) => {
    const groupId = getTagGroupFilterGroupId(id);
    return groupId === null ? [id] : resolveTagGroupTagIds(taxonomy, groupId);
  }))];
  const groups: TagChoice[][] = [[]];
  for (let index = 0; index < formula.clauses.length; index++) {
    const clause = formula.clauses[index];
    const alternatives = clause.operator === "OR" && clause.tagIds.length
      ? clause.tagIds.map((tag) => ({ add: [tag], remove: removeTerms(clause.excludedTagIds) }))
      : [{ add: clause.tagIds, remove: removeTerms(clause.excludedTagIds) }];
    if (index > 0 && formula.connectors[index - 1] === "OR") groups.push([]);
    const group = groups[groups.length - 1];
    if (Math.max(group.length, 1) * alternatives.length > 256) return null;
    groups[groups.length - 1] = group.length ? group.flatMap((left) => alternatives.map((right) => ({
      add: [...new Set([...left.add, ...right.add])], remove: [...new Set([...left.remove, ...right.remove])],
    }))) : alternatives;
  }
  const choices = groups.flat().map((choice) => ({
    add: choice.add.filter((id) => !tagIds.includes(id)),
    remove: choice.remove.filter((id) => tagIds.includes(id)),
  })).filter((choice) => evaluateTagFilterFormula(applyTagChoice(tagIds, choice), formula, taxonomy));
  return choices.filter((choice, index) => !choices.some((other, otherIndex) =>
    otherIndex !== index && other.add.every((id) => choice.add.includes(id)) && other.remove.every((id) => choice.remove.includes(id)) &&
    (other.add.length + other.remove.length < choice.add.length + choice.remove.length || otherIndex < index)));
}

export function applyTagChoice(tagIds: string[], choice: TagChoice): string[] {
  return [...new Set([...tagIds.filter((id) => !choice.remove.includes(id)), ...choice.add])];
}
