import { TrackData } from "@/types/tagData";
import { SmartPlaylistFilterCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import { isCamelotKeyInRange, normalizeCamelotKey } from "@/utils/camelotKey";
import { evaluateTagFilterFormula } from "@/utils/tagFilterGroups";

export function evaluateTrackMatchesCriteria(
  trackData: TrackData,
  criteria: SmartPlaylistFilterCriteria,
): boolean {
  const includeTagClauses = criteria.includeTagClauses ?? [];
  const clauseConnectors = criteria.clauseConnectors ?? [];
  const matchesIncludeTags =
    includeTagClauses.length === 0 ||
    evaluateTagFilterFormula(trackData.tagIds, {
      clauses: includeTagClauses,
      connectors: clauseConnectors,
    });

  const matchesRating =
    criteria.ratingFilters.length === 0 ||
    (trackData.rating > 0 && criteria.ratingFilters.includes(trackData.rating));

  const matchesEnergyMin =
    criteria.energyMinFilter === null ||
    trackData.energy >= criteria.energyMinFilter;

  const matchesEnergyMax =
    criteria.energyMaxFilter === null ||
    trackData.energy <= criteria.energyMaxFilter;

  const matchesBpmMin =
    criteria.bpmMinFilter === null ||
    (trackData.bpm !== null && trackData.bpm >= criteria.bpmMinFilter);

  const matchesBpmMax =
    criteria.bpmMaxFilter === null ||
    (trackData.bpm !== null && trackData.bpm <= criteria.bpmMaxFilter);

  const normalizedTrackCamelotKey = normalizeCamelotKey(trackData.camelotKey);
  const normalizedCamelotKeyFilters = (criteria.camelotKeyFilters ?? [])
    .map((key) => normalizeCamelotKey(key))
    .filter((key): key is string => key !== null);

  const matchesCamelotKeyFilters =
    normalizedCamelotKeyFilters.length === 0 ||
    (normalizedTrackCamelotKey !== null &&
      normalizedCamelotKeyFilters.includes(normalizedTrackCamelotKey));

  // Fallback for legacy saved playlists that used key ranges.
  const matchesLegacyCamelotRange =
    normalizedCamelotKeyFilters.length > 0 ||
    isCamelotKeyInRange(
      trackData.camelotKey,
      criteria.camelotMinFilter ?? null,
      criteria.camelotMaxFilter ?? null
    );

  return (
    matchesIncludeTags &&
    matchesRating &&
    matchesEnergyMin &&
    matchesEnergyMax &&
    matchesBpmMin &&
    matchesBpmMax &&
    matchesCamelotKeyFilters &&
    matchesLegacyCamelotRange
  );
}
