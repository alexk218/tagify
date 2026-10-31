import {
  CATALOG_FILL_PROTOCOL_VERSION, isCatalogFillReleaseDate, MAX_CATALOG_FILL_ARTISTS_PER_TRACK, MAX_CATALOG_FILL_RELEASES,
  MAX_CATALOG_FILL_REPORT_ITEMS, MAX_CATALOG_FILL_TRACKS, normalizeCatalogFillName, normalizeCatalogFillReleaseKind,
  parseCatalogFillJobs, type CatalogFillJobV1, type CatalogFillPaceV1, type CatalogFillReleaseV1, type CatalogFillReportItemV1,
  type CatalogFillTrackV1,
} from "@tagify/sync-contracts";
import type { SpotifyAlbumTrack, SpotifyArtistRelease } from "@/services/SpotifyApiService";
import { CatalogFillFailures, type CatalogFillCause } from "./CatalogFillFailures";
import type { CatalogFillAllowance } from "./CommunityCatalogFill";
import { releaseDate } from "./CommunitySongReleases";
import type { SendSession } from "./SpotifyLibrarySender";
import { syncClientHeaders } from "./SyncClientHeaders";

// Album track lists and artist discographies Community couldn't get from MusicBrainz or Spotify's
// embed page (Community pending migration 9004; artist and album pages, Slice 3). Only a desktop
// Community lists as a catalog filler (Alex's) is handed any: GET /api/v2/sync/catalog-fill gives
// it jobs and the pace to keep, and every other desktop gets none and reads nothing. Reads go
// through Spotify's desktop app (GraphQL getAlbum and queryArtistDiscographyAll, never the Web API),
// one at a time under the filler's allowance (CommunityCatalogFill.ts), and stop when Spotify asks
// Tagify to wait or keeps failing (CatalogFillFailures.ts); one item Spotify can't read is skipped.
// Only Community advertising `catalogFill` protocol 1 starts a run.

const JOBS_PER_PAGE = 20;
const MAX_ROUNDS = 50;

/** Where the filler reads, and the allowance it reads under. */
export interface CatalogFillJobSources {
  /** One album's tracks in order (one getAlbum read, more pages for long albums). Null when Spotify can't say. */
  albumTracks(albumUri: string): Promise<SpotifyAlbumTrack[] | null>;
  /** One artist's releases, newest first. `beforePage` takes each page's read; null when stopped or Spotify can't say. */
  artistReleases(artistUri: string, beforePage: () => Promise<boolean>): Promise<SpotifyArtistRelease[] | null>;
  allowance: CatalogFillAllowance;
  /** Keeps the pace Community advertised for the song fills too; null forgets it. */
  savePace(pace: CatalogFillPaceV1 | null): void;
}

export interface CatalogFillRun {
  sent: number;
  /** Spotify reads made. */
  reads: number;
  /** Whether Community listed this desktop as a catalog filler; unset when no jobs page answered. */
  filler?: boolean;
  stopped?: "unsupported" | "paused" | "signed_out" | "network" | "spotify" | "budget";
  /** Why it stopped, when that wasn't finishing or the allowance. */
  cause?: CatalogFillCause;
  /** Items Spotify failed to read that the run went past, and the last one's cause. */
  skipped?: number;
  lastSkip?: CatalogFillCause;
}

const COMMUNITY_ENDPOINT = "Community catalog-fill";

class Stop extends Error {
  constructor(readonly reason: NonNullable<CatalogFillRun["stopped"]>, readonly detail?: CatalogFillCause) { super(`Catalog fill stopped: ${reason}`); }
}

const stopFor = (status: number): NonNullable<CatalogFillRun["stopped"]> =>
  status === 404 ? "unsupported" : status === 503 ? "paused" : status === 401 || status === 403 ? "signed_out" : "network";

/** An album's tracks as Community takes them, or null when Spotify's list can't be sent as it is. */
export function catalogFillTracks(tracks: SpotifyAlbumTrack[] | null | undefined): CatalogFillTrackV1[] | null {
  if (!tracks?.length || tracks.length > MAX_CATALOG_FILL_TRACKS) return null;
  const places = new Set<string>();
  const result: CatalogFillTrackV1[] = [];
  for (const track of tracks) {
    const providerId = /^spotify:track:([A-Za-z0-9]{22})$/.exec(track.uri)?.[1];
    const name = normalizeCatalogFillName(track.name);
    const { discNumber: disc, trackNumber: position } = track;
    if (!providerId || !name || !Number.isInteger(disc) || disc < 1 || disc > 99 || !Number.isInteger(position) || position < 1
      || position > MAX_CATALOG_FILL_TRACKS || places.has(`${disc}:${position}`)) return null;
    places.add(`${disc}:${position}`);
    const artists = (track.artistsData ?? []).flatMap((artist) => {
      const id = /^spotify:artist:([A-Za-z0-9]{22})$/.exec(artist.uri)?.[1];
      const artistName = normalizeCatalogFillName(artist.name);
      return id && artistName ? [{ providerId: id, name: artistName }] : [];
    }).filter((artist, index, all) => all.findIndex((other) => other.providerId === artist.providerId) === index)
      .slice(0, MAX_CATALOG_FILL_ARTISTS_PER_TRACK);
    const durationMs = Number.isInteger(track.durationMs) && track.durationMs! >= 1 && track.durationMs! <= 86_400_000 ? track.durationMs! : null;
    result.push({ disc, position, providerId, name, artists, durationMs });
  }
  return result;
}

/** An artist's releases as Community takes them: kinds it knows, one entry per album. Null when none are usable. */
export function catalogFillReleases(releases: SpotifyArtistRelease[] | null | undefined): CatalogFillReleaseV1[] | null {
  const seen = new Set<string>();
  const result = (releases ?? []).flatMap((release): CatalogFillReleaseV1[] => {
    const providerId = /^spotify:album:([A-Za-z0-9]{22})$/.exec(release.uri)?.[1];
    const name = normalizeCatalogFillName(release.name);
    const albumType = normalizeCatalogFillReleaseKind(release.type);
    if (!providerId || !name || !albumType || seen.has(providerId)) return [];
    seen.add(providerId);
    const date = releaseDate(release.date);
    return [{ providerId, name, albumType, releaseDate: isCatalogFillReleaseDate(date) ? date : null }];
  }).slice(0, MAX_CATALOG_FILL_RELEASES);
  return result.length ? result : null;
}

/**
 * Reads one job under the allowance. Undefined when the read didn't happen or was cut short (the
 * job is handed out again later); a "missing" item when Spotify had nothing usable.
 */
async function readJob(
  job: CatalogFillJobV1, sources: CatalogFillJobSources, counted: { reads: number; halted: CatalogFillRun["stopped"] | null },
  failures: CatalogFillFailures,
): Promise<CatalogFillReportItemV1 | undefined> {
  const take = async (identity: string) => {
    if (!sources.allowance.reserve(identity)) { counted.halted = "budget"; return false; }
    counted.reads += 1;
    await sources.allowance.pace();
    return true;
  };
  // Spotify asking Tagify to wait stops the run, never retried around; any other failure skips this
  // job (Community hands it out again later), unless too many fail in a row.
  try {
    if (job.kind === "albumTracks") {
      const uri = `spotify:album:${job.providerId}`;
      if (!await take(`catalog-fill:${uri}`)) return undefined;
      const tracks = catalogFillTracks(await sources.albumTracks(uri));
      failures.succeeded();
      return tracks ? { kind: job.kind, providerId: job.providerId, outcome: "found", tracks } : { kind: job.kind, providerId: job.providerId, outcome: "missing" };
    }
    const uri = `spotify:artist:${job.providerId}`;
    let page = 0;
    const raw = await sources.artistReleases(uri, () => take(`catalog-fill:${uri}:${page++}`));
    if (counted.halted) return undefined;
    failures.succeeded();
    const releases = catalogFillReleases(raw);
    return releases ? { kind: job.kind, providerId: job.providerId, outcome: "found", releases } : { kind: job.kind, providerId: job.providerId, outcome: "missing" };
  } catch (error) {
    if (failures.failed(error, job.kind === "albumTracks" ? "GraphQL getAlbum" : "GraphQL queryArtistDiscographyAll")) counted.halted = "spotify";
    return undefined;
  }
}

/**
 * Asks Community for catalog fill jobs and sends what Spotify's desktop app says, page by page,
 * until nothing is left, the allowance is used up, or Spotify or Community asks Tagify to stop.
 * Never throws.
 */
export async function runCatalogFillJobs(
  session: SendSession, sources: CatalogFillJobSources, options: { request?: typeof fetch; maxRounds?: number } = {},
): Promise<CatalogFillRun> {
  const request = options.request ?? fetch;
  const run: CatalogFillRun = { sent: 0, reads: 0 };
  const failures = new CatalogFillFailures();
  const call = async (path: string, init: RequestInit = {}) => {
    const current = await session();
    let response: Response;
    try {
      response = await request(`${current.apiBaseUrl}/api/v2/sync/catalog-fill${path.replace("{device}", encodeURIComponent(current.deviceId))}`, {
        ...init,
        headers: { ...syncClientHeaders(current.accessToken), ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch {
      throw new Stop("network", { kind: "network", endpoint: COMMUNITY_ENDPOINT });
    }
    if (!response.ok) throw new Stop(stopFor(response.status), { kind: "community-http", status: response.status, endpoint: COMMUNITY_ENDPOINT });
    return await response.json().catch(() => null) as unknown;
  };
  const send = async (items: CatalogFillReportItemV1[]) => {
    for (let start = 0; start < items.length; start += MAX_CATALOG_FILL_REPORT_ITEMS) {
      const page = items.slice(start, start + MAX_CATALOG_FILL_REPORT_ITEMS);
      const current = await session();
      await call("", { method: "POST", body: JSON.stringify({ protocolVersion: CATALOG_FILL_PROTOCOL_VERSION, deviceId: current.deviceId, items: page }) });
      run.sent += page.length;
    }
  };
  try {
    for (let round = 0; round < (options.maxRounds ?? MAX_ROUNDS); round++) {
      let jobs;
      try { jobs = parseCatalogFillJobs(await call(`?deviceId={device}&limit=${JOBS_PER_PAGE}`)); }
      catch (error) { if (error instanceof Stop) throw error; throw new Stop("network", { kind: "bad-answer", endpoint: COMMUNITY_ENDPOINT }); }
      sources.savePace(jobs.pace);
      run.filler = jobs.filler;
      if (!jobs.filler || !jobs.items.length) break;
      const counted = { reads: 0, halted: null as CatalogFillRun["stopped"] | null };
      const found: CatalogFillReportItemV1[] = [];
      for (const job of jobs.items) {
        const item = await readJob(job, sources, counted, failures);
        if (item) found.push(item);
        if (counted.halted) break;
      }
      run.reads += counted.reads;
      // What a page found is sent even when Spotify stopped answering partway.
      await send(found);
      if (counted.halted) { run.stopped = counted.halted; break; }
      if (!jobs.hasMore) break;
    }
  } catch (error) {
    run.stopped = error instanceof Stop ? error.reason : "network";
    if (!failures.cause) failures.cause = error instanceof Stop && error.detail ? error.detail : { kind: "error", endpoint: COMMUNITY_ENDPOINT };
  }
  return { ...run, ...failures.summary() };
}
