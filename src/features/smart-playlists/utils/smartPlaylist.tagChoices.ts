import type { SmartPlaylistFilterCriteria } from "../model/smartPlaylist.types";
import { evaluateTagFilterFormula, normalizeTagFilterFormula } from "@/utils/tagFilterGroups";

export interface TagChoice { add: string[]; remove: string[] }

/** Minimal alternatives that satisfy the formula. null requests manual selection for large formulas. */
export function smartPlaylistTagChoices(tagIds: string[], criteria: SmartPlaylistFilterCriteria): TagChoice[] | null {
  const formula = normalizeTagFilterFormula({ clauses: criteria.includeTagClauses, connectors: criteria.clauseConnectors });
  if (evaluateTagFilterFormula(tagIds, formula)) return [{ add: [], remove: [] }];
  const groups: TagChoice[][] = [[]];
  for (let index = 0; index < formula.clauses.length; index++) {
    const clause = formula.clauses[index];
    const alternatives = clause.operator === "OR" && clause.tagIds.length
      ? clause.tagIds.map((tag) => ({ add: [tag], remove: clause.excludedTagIds }))
      : [{ add: clause.tagIds, remove: clause.excludedTagIds }];
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
  })).filter((choice) => evaluateTagFilterFormula(applyTagChoice(tagIds, choice), formula));
  return choices.filter((choice, index) => !choices.some((other, otherIndex) =>
    otherIndex !== index && other.add.every((id) => choice.add.includes(id)) && other.remove.every((id) => choice.remove.includes(id)) &&
    (other.add.length + other.remove.length < choice.add.length + choice.remove.length || otherIndex < index)));
}

export function applyTagChoice(tagIds: string[], choice: TagChoice): string[] {
  return [...new Set([...tagIds.filter((id) => !choice.remove.includes(id)), ...choice.add])];
}
