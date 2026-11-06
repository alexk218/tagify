import { TrackData } from "@/types/tagData";
import { SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { isCamelotKeyInRange, normalizeCamelotKey } from "@/utils/camelotKey";
import { compileTagFilterFormula } from "@/utils/tagFilterGroups";
import { matchesSongDetailFilters } from "@/utils/songDetails";

export function evaluateTrackMatchesCriteria(
  trackData: TrackData,
  criteria: SmartPlaylistFilterCriteria,
): boolean {
  return compileTrackCriteria(criteria)(trackData);
}

/**
 * Prepares a playlist's rules once. Large libraries check every song against
 * every playlist, so per-song setup work adds up to seconds.
 */
export function compileTrackCriteria(
  criteria: SmartPlaylistFilterCriteria,
): (trackData: TrackData) => boolean {
  const includeTagClauses = criteria.includeTagClauses ?? [];
  const clauseConnectors = criteria.clauseConnectors ?? [];
  const matchesIncludeTags =
    includeTagClauses.length === 0
      ? () => true
      : compileTagFilterFormula({
          clauses: includeTagClauses,
          connectors: clauseConnectors,
        });
  const normalizedCamelotKeyFilters = (criteria.camelotKeyFilters ?? [])
    .map((key) => normalizeCamelotKey(key))
    .filter((key): key is string => key !== null);
  const camelotMin = criteria.camelotMinFilter ?? null;
  const camelotMax = criteria.camelotMaxFilter ?? null;

  return (trackData) => {
    if (!matchesIncludeTags(trackData.tagIds)) return false;

    if (
      criteria.ratingFilters.length > 0 &&
      !(trackData.rating > 0 && criteria.ratingFilters.includes(trackData.rating))
    ) return false;

    if (criteria.energyMinFilter !== null && !(trackData.energy >= criteria.energyMinFilter)) return false;
    if (criteria.energyMaxFilter !== null && !(trackData.energy <= criteria.energyMaxFilter)) return false;

    if (
      criteria.bpmMinFilter !== null &&
      !(trackData.bpm !== null && trackData.bpm >= criteria.bpmMinFilter)
    ) return false;
    if (
      criteria.bpmMaxFilter !== null &&
      !(trackData.bpm !== null && trackData.bpm <= criteria.bpmMaxFilter)
    ) return false;

    if (normalizedCamelotKeyFilters.length > 0) {
      const normalizedTrackCamelotKey = normalizeCamelotKey(trackData.camelotKey);
      if (
        normalizedTrackCamelotKey === null ||
        !normalizedCamelotKeyFilters.includes(normalizedTrackCamelotKey)
      ) return false;
    } else if (!isCamelotKeyInRange(trackData.camelotKey, camelotMin, camelotMax)) {
      // Fallback for legacy saved playlists that used key ranges.
      return false;
    }

    return matchesSongDetailFilters(trackData, criteria);
  };
}
