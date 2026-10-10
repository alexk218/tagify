import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { hasTrackAnnotation, summarizeTrackUris } from "@/features/playlist-state";
import type { TrackArtist } from "@/services/trackArtistIdentities";
import { buildResolvedTagLookup } from "@/utils/tagTaxonomy";

export function buildArtistTrackSummaries(
  tracks: Record<string, TrackData>, taxonomy: TagTaxonomy,
  identities: Readonly<Record<string, { artists: TrackArtist[]; }>>,
) {
  const groups = new Map<string, { name: string; uris: Set<string>; }>();
  Object.entries(tracks).forEach(([uri, track]) => {
    if (!hasTrackAnnotation(track, taxonomy)) return;
    identities[uri]?.artists.forEach((artist) => {
      const group = groups.get(artist.uri) ?? { name: artist.name, uris: new Set<string>() };
      group.uris.add(uri);
      groups.set(artist.uri, group);
    });
  });
  const resolvedTags = buildResolvedTagLookup(taxonomy);
  return new Map(Array.from(groups, ([uri, group]) => [uri, {
    ...summarizeTrackUris(tracks, taxonomy, group.uris, resolvedTags), artistName: group.name,
  }]));
}
