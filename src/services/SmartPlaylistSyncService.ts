import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";
import {
  showSmartPlaylistCriteriaAppliedNotifications,
  SmartPlaylistAppliedCriteriaNotification,
} from "@/features/smart-playlists/utils/smartPlaylist.notifications";
import { evaluateTrackMatchesCriteria } from "@/features/smart-playlists/utils/smartPlaylist.criteria";
import {
  applySmartPlaylistCriteriaToTrack,
  collectMatchingTrackUris,
  findDuplicateTrackUris,
} from "@/features/smart-playlists/utils/smartPlaylist.syncUtils";
import {
  hasConfirmedMembershipBaseline,
  loadSmartPlaylistsFromStorage,
  markConfirmedMembershipBaselines,
  clearConfirmedMembershipBaselines,
  updateSmartPlaylistsInStorage,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { dispatchTagDataUpdatedEvent } from "@/features/tag-data/utils/tagData.events";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { storageService } from "@/services/storage/StorageService";
import { recordingDisplayKeys } from "@/features/recording-reuse/utils/recordingLibrary";
import {
  flushLocalPersistence,
  getTagifyDatabaseName,
  isLocalPersistencePaused,
} from "@/services/sync/SyncLocalState";
import { smartPlaylistTagChoices, applyTagChoice, type TagChoice } from "@/features/smart-playlists/utils/smartPlaylist.tagChoices";
import { evaluateTagFilterFormula } from "@/utils/tagFilterGroups";
import { TrackData } from "@/types/tagData";

const RECONCILIATION_INTERVAL_MS = 60_000;
const PLAYLIST_API_HOOK_MARKER = "__tagifySmartPlaylistAddHook";
const SMART_PLAYLISTS_UPDATED_EVENT = "tagify:smartPlaylistsUpdated";

interface DesktopPlaylistApi {
  add?: (...args: unknown[]) => Promise<unknown>;
  [PLAYLIST_API_HOOK_MARKER]?: boolean;
}

export interface SmartPlaylistReconciliationSummary {
  addedCount: number;
  removedCount: number;
  metadataUpdatedCount: number;
  duplicatesRemovedCount: number;
  failedPlaylistNames: string[];
}

function emptySummary(): SmartPlaylistReconciliationSummary {
  return {
    addedCount: 0,
    removedCount: 0,
    metadataUpdatedCount: 0,
    duplicatesRemovedCount: 0,
    failedPlaylistNames: [],
  };
}

function uniqueTrackUris(trackUris: string[]): string[] {
  return Array.from(new Set(trackUris));
}

/**
 * The Tagify page and the background extension are separate bundles, each with
 * its own SmartPlaylistSyncService. Both change the same Spotify playlists,
 * saved songs and last-confirmed membership, so their work takes turns: one
 * copy's playlist additions must never look like songs added in Spotify to the
 * other copy while it is reading Spotify.
 */
export const SMART_PLAYLIST_SYNC_LOCK = "tagify:smart-playlist-sync";

export interface SmartPlaylistSyncLockManager {
  request<T>(
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal },
    callback: () => Promise<T>,
  ): Promise<T>;
}

/**
 * How long one copy waits for the other to finish. A stuck Spotify request
 * in one copy then delays the other's work to a later pass instead of
 * blocking it indefinitely.
 */
const SMART_PLAYLIST_LOCK_WAIT_MS = 60_000;

function defaultLockManager(): SmartPlaylistSyncLockManager | undefined {
  return typeof navigator === "undefined"
    ? undefined
    : (navigator.locks as SmartPlaylistSyncLockManager | undefined);
}

/** Details looked up for a song that has no saved record yet. */
interface NewTrackDetails {
  name?: string;
  artists?: string;
  bpm: number | null;
  camelotKey?: string;
}

function localFileDetails(trackUri: string): NewTrackDetails {
  const [, , localArtist, , localTrackName] = trackUri.split(":");
  let name: string | undefined;
  let artists: string | undefined;
  try {
    name = localTrackName ? decodeURIComponent(localTrackName) : undefined;
    artists = localArtist ? decodeURIComponent(localArtist) : undefined;
  } catch {
    name = localTrackName || undefined;
    artists = localArtist || undefined;
  }
  return { bpm: null, ...(name ? { name } : {}), ...(artists ? { artists } : {}) };
}

function newTrackRecord(
  trackUri: string,
  details: NewTrackDetails | undefined,
  now: number,
): TrackData {
  const { name, artists, bpm, camelotKey } = details ??
    (trackUri.startsWith("spotify:local:") ? localFileDetails(trackUri) : { bpm: null });
  return {
    rating: 0,
    energy: 0,
    bpm,
    ...(camelotKey ? { camelotKey } : {}),
    tagIds: [],
    dateCreated: now,
    dateModified: now,
    ...(name ? { name } : {}),
    ...(artists ? { artists } : {}),
  };
}

/**
 * Adds details looked up for a new song to a record saved in the meantime,
 * filling only what is still missing. Details are not annotations, so Last
 * Updated stays unchanged.
 */
function withMissingDetails(track: TrackData, details: NewTrackDetails | undefined): TrackData {
  if (!details) return track;
  const missing: Partial<TrackData> = {
    ...(!track.name && details.name ? { name: details.name } : {}),
    ...(!track.artists && details.artists ? { artists: details.artists } : {}),
    ...(track.bpm == null && details.bpm != null ? { bpm: details.bpm } : {}),
    ...(!track.camelotKey && details.camelotKey ? { camelotKey: details.camelotKey } : {}),
  };
  return Object.keys(missing).length > 0 ? { ...track, ...missing } : track;
}

function sameTagIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((tagId, index) => tagId === right[index]);
}

export class SmartPlaylistSyncService {
  constructor(
    private readonly lockManager: SmartPlaylistSyncLockManager | undefined = defaultLockManager(),
  ) {}

  private lastFailureNoticeAt = -Infinity;
  private operationQueue: Promise<void> = Promise.resolve();
  private backgroundStarted = false;
  private reconciliationTimer: ReturnType<typeof setTimeout> | null = null;
  private backgroundTask: Promise<void> | null = null;
  private readonly handleWindowFocus = () => this.queueBackgroundReconciliation();
  private readonly handleWindowBlur = () => this.clearReconciliationTimer();
  private readonly handleVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      this.queueBackgroundReconciliation();
    } else {
      this.clearReconciliationTimer();
    }
  };

  private getSmartPlaylists(): Promise<SmartPlaylistCriteria[]> {
    return loadSmartPlaylistsFromStorage();
  }

  private async updateSmartPlaylists(
    updater: (current: SmartPlaylistCriteria[]) => SmartPlaylistCriteria[],
  ): Promise<SmartPlaylistCriteria[]> {
    let changed = false;
    const playlists = await updateSmartPlaylistsInStorage((current) => {
      const next = updater(current);
      changed = next !== current;
      return next;
    });
    if (!changed) return playlists;
    window.dispatchEvent(
      new CustomEvent(SMART_PLAYLISTS_UPDATED_EVENT, {
        detail: {
          count: playlists.length,
          playlistIds: playlists.map((playlist) => playlist.playlistId),
          playlists,
        },
      }),
    );
    return playlists;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    // The queue keeps this copy's order; the lock takes turns with the other bundle.
    const exclusive = () => this.lockManager
      ? this.lockManager.request(
          SMART_PLAYLIST_SYNC_LOCK,
          { mode: "exclusive", signal: AbortSignal.timeout(SMART_PLAYLIST_LOCK_WAIT_MS) },
          operation,
        ).catch((error: unknown) => {
          if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
            throw new Error("Smart Playlists are still updating elsewhere in Tagify. They'll catch up on the next check.");
          }
          throw error;
        })
      : operation();
    const result = this.operationQueue.then(exclusive, exclusive);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async getOrderedActivePlaylists(): Promise<SmartPlaylistCriteria[]> {
    return (await this.getSmartPlaylists())
      .map((playlist, persistedIndex) => ({ playlist, persistedIndex }))
      .filter(({ playlist }) => Boolean(playlist?.playlistId && playlist.isActive))
      .sort(
        (left, right) =>
          left.playlist.createdAt - right.playlist.createdAt ||
          left.persistedIndex - right.persistedIndex,
      )
      .map(({ playlist }) => playlist);
  }

  private async fetchNewTrackDetails(trackUri: string): Promise<NewTrackDetails> {
    if (trackUri.startsWith("spotify:local:")) {
      return localFileDetails(trackUri);
    }
    const [metadataResult, audioFeaturesResult] = await Promise.allSettled([
      spotifyService.getTrack(trackUri),
      spotifyApiService.fetchAudioFeatures(trackUri),
    ]);
    const metadata = metadataResult.status === "fulfilled" ? metadataResult.value : null;
    const audioFeatures = audioFeaturesResult.status === "fulfilled" ? audioFeaturesResult.value : null;
    return {
      bpm: audioFeatures?.bpm ?? null,
      ...(audioFeatures?.camelotKey ? { camelotKey: audioFeatures.camelotKey } : {}),
      ...(metadata?.name ? { name: metadata.name } : {}),
      ...(metadata?.artists ? { artists: metadata.artists } : {}),
    };
  }

  /** Applies each playlist's criteria in order (oldest first) to one song. */
  private applyCriteriaForMemberships(
    trackData: TrackData,
    playlists: SmartPlaylistCriteria[],
    now: number,
  ): TrackData {
    const updated = playlists.reduce(
      (current, playlist) => applySmartPlaylistCriteriaToTrack(current, playlist.criteria, now),
      trackData,
    );

    const mutableCriteriaUnchanged =
      updated.rating === trackData.rating &&
      updated.energy === trackData.energy &&
      sameTagIds(updated.tagIds, trackData.tagIds);

    if (mutableCriteriaUnchanged) {
      return trackData;
    }

    return {
      ...updated,
      dateCreated: trackData.dateCreated || now,
      dateModified: now,
    };
  }

  /**
   * Gives songs newly found in Spotify playlists the playlists' tags, rating
   * and energy. Details for songs without a saved record are looked up first;
   * each song is then changed from its current saved record in one step, so
   * tags, ratings and other edits saved in the meantime are kept.
   */
  private async applyInboundCriteria(
    playlists: SmartPlaylistCriteria[],
    membershipByPlaylistId: Map<string, string[]>,
    expectedDatabaseName: string,
    knownTracks?: Record<string, TrackData | undefined>,
  ): Promise<{
    updatedCount: number;
    tracks: Map<string, TrackData>;
    notifications: SmartPlaylistAppliedCriteriaNotification[];
  }> {
    const tracks = new Map<string, TrackData>();
    const notifications: SmartPlaylistAppliedCriteriaNotification[] = [];
    const memberTrackUris = uniqueTrackUris(
      Array.from(membershipByPlaylistId.values()).flat(),
    );
    if (memberTrackUris.length === 0) {
      return { updatedCount: 0, tracks, notifications };
    }

    // Only decides which songs need a lookup; the save reads every record again.
    const known = knownTracks ??
      Object.fromEntries(await storageService.getTracks(memberTrackUris));
    const details = new Map<string, NewTrackDetails>();
    for (const trackUri of memberTrackUris) {
      if (!known[trackUri]) {
        details.set(trackUri, await this.fetchNewTrackDetails(trackUri));
      }
    }

    const memberSets = new Map(
      Array.from(membershipByPlaylistId, ([playlistId, uris]) => [playlistId, new Set(uris)]),
    );
    const pending = new Map<string, Set<string>>();
    const now = Date.now();
    const applyToSavedTrack = (trackUri: string) => (current: TrackData | null) => {
      const trackPlaylists = playlists.filter((playlist) =>
        memberSets.get(playlist.playlistId)?.has(trackUri),
      );
      const initial = current
        ? withMissingDetails(current, details.get(trackUri))
        : newTrackRecord(trackUri, details.get(trackUri), now);
      const updated = this.applyCriteriaForMemberships(initial, trackPlaylists, now);
      const undecided = trackPlaylists.filter((playlist) => {
        const choices = smartPlaylistTagChoices(updated.tagIds, playlist.criteria);
        return !choices || choices.length > 1;
      });
      undecided.forEach((playlist) => {
        const uris = pending.get(playlist.playlistId) ?? new Set<string>();
        uris.add(trackUri);
        pending.set(playlist.playlistId, uris);
      });

      const applied = updated !== initial || undecided.length > 0;
      if (applied) {
        notifications.push({
          trackName: updated.name,
          artists: updated.artists,
          playlistNames: trackPlaylists.map((playlist) => playlist.playlistName),
          addedTagIds: updated.tagIds.filter((tagId) => !initial.tagIds.includes(tagId)),
          removedTagIds: initial.tagIds.filter((tagId) => !updated.tagIds.includes(tagId)),
          ...(updated.rating !== initial.rating ? { rating: updated.rating } : {}),
          ...(updated.energy !== initial.energy ? { energy: updated.energy } : {}),
        });
      }
      if (!current && !applied) return undefined;
      tracks.set(trackUri, updated);
      return updated === current ? undefined : updated;
    };

    let saved: Record<string, TrackData | null>;
    try {
      saved = await indexedDBStorage.patchTracks(
        Object.fromEntries(memberTrackUris.map((trackUri) => [trackUri, applyToSavedTrack(trackUri)])),
        { expectedDatabaseName },
      );
    } catch (error) {
      console.error("Tagify: Smart Playlist changes to new songs could not be saved", error);
      throw new Error("Smart Playlist changes to your songs could not be saved. Please try again.");
    }
    // Linked copies of a song receive the same changes.
    Object.entries(saved).forEach(([trackUri, trackData]) => {
      if (trackData) tracks.set(trackUri, trackData);
    });
    if (Object.keys(saved).length > 0) {
      dispatchTagDataUpdatedEvent("smartPlaylistSync");
    }

    // Persist the pending choice before advancing the membership baseline.
    if (pending.size) await this.updateSmartPlaylists((current) => current.map((playlist) => {
      const uris = pending.get(playlist.playlistId);
      return uris ? { ...playlist, pendingTagChoices: [...new Set([...(playlist.pendingTagChoices ?? []), ...uris])] } : playlist;
    }));

    return {
      updatedCount: notifications.length,
      tracks,
      notifications,
    };
  }

  private async deduplicatePlaylist(
    playlist: SmartPlaylistCriteria,
    trackUris: string[],
  ): Promise<{ trackUris: string[]; removedCount: number }> {
    const { duplicateUris } = findDuplicateTrackUris(trackUris);
    const removedCount = duplicateUris.size
      ? await spotifyApiService.removeDuplicatePlaylistOccurrences(playlist.playlistId)
      : 0;

    return {
      trackUris:
        duplicateUris.size > 0
          ? await spotifyApiService.getAllTrackUrisInPlaylistStrict(
              playlist.playlistId,
            )
          : trackUris,
      removedCount,
    };
  }

  private async reconcileNow(
    targetPlaylistId?: string,
    background = false,
  ): Promise<SmartPlaylistReconciliationSummary> {
    const summary = emptySummary();
    if (!storageService.isReady() || isLocalPersistencePaused()) {
      if (targetPlaylistId) {
        throw new Error("Smart playlist sync is waiting for local data to become ready");
      }
      return summary;
    }
    await flushLocalPersistence();
    const databaseName = getTagifyDatabaseName();

    let playlists = (await this.getOrderedActivePlaylists()).filter(
      (playlist) => !targetPlaylistId || playlist.playlistId === targetPlaylistId,
    );
    if (playlists.length === 0) {
      if (targetPlaylistId) {
        throw new Error("Smart playlist is no longer active or available");
      }
      return summary;
    }

    // A failed read stops here, before Spotify or any saved song changes.
    const allTagData = await storageService.loadAllStrict();
    const membershipByPlaylistId = new Map<string, string[]>();
    const inboundAdditionsByPlaylistId = new Map<string, string[]>();
    const successfullyFetched = new Set<string>();
    const writtenPlaylistIds = new Set<string>();

    for (const playlist of playlists) {
      try {
        const fetched = await spotifyApiService.getAllTrackUrisInPlaylistStrict(
          playlist.playlistId,
        );
        const deduplicated = await this.deduplicatePlaylist(playlist, fetched);
        if (deduplicated.removedCount > 0) {
          writtenPlaylistIds.add(playlist.playlistId);
        }
        membershipByPlaylistId.set(
          playlist.playlistId,
          uniqueTrackUris(deduplicated.trackUris),
        );
        summary.duplicatesRemovedCount += deduplicated.removedCount;
        successfullyFetched.add(playlist.playlistId);
      } catch (error) {
        console.error(
          `Failed to fetch smart playlist ${playlist.playlistName}:`,
          error,
        );
        summary.failedPlaylistNames.push(playlist.playlistName);
      }
    }

    if (successfullyFetched.size === 0) {
      return summary;
    }

    // Reading Spotify takes time. Compare with the membership saved now as
    // well, so songs Tagify added meanwhile are not taken for songs added in
    // Spotify, and leave playlists that were turned off or replaced alone.
    const latestPlaylists = new Map(
      (await this.getSmartPlaylists()).map((playlist) => [playlist.playlistId, playlist]),
    );
    playlists = playlists.flatMap((playlist) => {
      const latest = latestPlaylists.get(playlist.playlistId);
      if (!latest?.isActive || latest.createdAt !== playlist.createdAt) {
        successfullyFetched.delete(playlist.playlistId);
        return [];
      }
      const fetched = membershipByPlaylistId.get(playlist.playlistId);
      if (fetched) {
        const known = new Set([
          ...(playlist.smartPlaylistTrackUris ?? []),
          ...(latest.smartPlaylistTrackUris ?? []),
        ]);
        inboundAdditionsByPlaylistId.set(
          playlist.playlistId,
          hasConfirmedMembershipBaseline(latest)
            ? fetched.filter((trackUri) => !known.has(trackUri))
            : [],
        );
      }
      return [latest];
    });
    if (successfullyFetched.size === 0) {
      return summary;
    }

    const inbound = await this.applyInboundCriteria(
      playlists,
      inboundAdditionsByPlaylistId,
      databaseName,
      allTagData.tracks,
    );
    summary.metadataUpdatedCount = inbound.updatedCount;

    for (const [trackUri, trackData] of inbound.tracks) {
      allTagData.tracks[trackUri] = trackData;
    }
    showSmartPlaylistCriteriaAppliedNotifications(
      inbound.notifications,
      allTagData.taxonomy,
    );

    const pendingPlaylists = await this.getSmartPlaylists();
    for (const playlist of playlists) {
      if (!successfullyFetched.has(playlist.playlistId)) {
        continue;
      }

      const currentMembership =
        membershipByPlaylistId.get(playlist.playlistId) ?? [];
      const currentMembers = new Set(currentMembership);
      const matchingTrackUris = collectMatchingTrackUris(
        allTagData.tracks,
        playlist.criteria,
        currentMembership,
      );

      if (hasConfirmedMembershipBaseline(playlist)) {
        let missingDataRemovedCount = 0;
        for (const trackUri of [...currentMembership]) {
          const trackData = allTagData.tracks[trackUri];
          if (pendingPlaylists.find((item) => item.playlistId === playlist.playlistId)?.pendingTagChoices?.includes(trackUri)) continue;
          // Missing annotations also mean the member is ineligible. New
          // additions have already received their criteria above; never
          // recreate a cleared rating merely because a song remains here.
          if (trackData && evaluateTrackMatchesCriteria(trackData, playlist.criteria)) {
            continue;
          }
          writtenPlaylistIds.add(playlist.playlistId);
          if (await spotifyApiService.removeTrackFromPlaylist(trackUri, playlist.playlistId)) {
            currentMembers.delete(trackUri);
            summary.removedCount += 1;
            if (!trackData) missingDataRemovedCount += 1;
          } else if (!summary.failedPlaylistNames.includes(playlist.playlistName)) {
            summary.failedPlaylistNames.push(playlist.playlistName);
          }
        }
        if (missingDataRemovedCount > 0) {
          const songs = missingDataRemovedCount === 1 ? "song" : "songs";
          Spicetify.showNotification(
            `“${playlist.playlistName}” removed ${missingDataRemovedCount} ${songs} with no saved Tagify details. If this was unexpected, restore your tags and ratings from a backup.`,
            false,
            10000,
          );
        }
      }

      for (const trackUri of matchingTrackUris) {
        if (currentMembers.has(trackUri)) {
          continue;
        }
        writtenPlaylistIds.add(playlist.playlistId);
        const result = await spotifyApiService.addTrackToSpotifyPlaylist(
          trackUri,
          playlist.playlistId,
        );
        if (result.success && result.wasAdded) {
          summary.addedCount += 1;
        } else if (!result.success && !summary.failedPlaylistNames.includes(playlist.playlistName)) {
          summary.failedPlaylistNames.push(playlist.playlistName);
        }
      }
    }

    const confirmedMemberships = new Map<string, string[]>();
    for (const playlist of playlists) {
      if (!successfullyFetched.has(playlist.playlistId)) {
        continue;
      }
      // Reuse the first read only for checks without Spotify writes or inbound
      // edits. Keep confirmation after operations that can take time or fail.
      if (!writtenPlaylistIds.has(playlist.playlistId) &&
          (inboundAdditionsByPlaylistId.get(playlist.playlistId)?.length ?? 0) === 0) {
        confirmedMemberships.set(
          playlist.playlistId,
          membershipByPlaylistId.get(playlist.playlistId) ?? [],
        );
        continue;
      }
      try {
        confirmedMemberships.set(
          playlist.playlistId,
          uniqueTrackUris(
            await spotifyApiService.getAllTrackUrisInPlaylistStrict(
              playlist.playlistId,
            ),
          ),
        );
      } catch (error) {
        console.error(
          `Failed to confirm smart playlist ${playlist.playlistName}:`,
          error,
        );
        summary.failedPlaylistNames.push(playlist.playlistName);
      }
    }

    if (confirmedMemberships.size > 0) {
      const now = Date.now();
      const updated = await this.updateSmartPlaylists((current) => {
        let changed = false;
        const next = current.map((playlist) => {
          const confirmed = confirmedMemberships.get(playlist.playlistId);
          if (!confirmed) return playlist;
          const previous = playlist.smartPlaylistTrackUris ?? [];
          const pendingTagChoices = playlist.pendingTagChoices?.filter((uri) => confirmed.includes(uri) &&
            (!allTagData.tracks[uri] || !evaluateTagFilterFormula(allTagData.tracks[uri].tagIds, {
              clauses: playlist.criteria.includeTagClauses, connectors: playlist.criteria.clauseConnectors,
            })));
          const choicesChanged = pendingTagChoices?.length !== playlist.pendingTagChoices?.length;
          const membershipChanged = previous.length !== confirmed.length ||
            previous.some((uri, index) => uri !== confirmed[index]);
          if (background && playlist.lastSyncAt && hasConfirmedMembershipBaseline(playlist) &&
              !membershipChanged && !choicesChanged && !writtenPlaylistIds.has(playlist.playlistId)) {
            return playlist;
          }
          changed = true;
          return { ...playlist, ...(pendingTagChoices ? { pendingTagChoices } : {}), smartPlaylistTrackUris: confirmed, lastSyncAt: now };
        });
        return changed ? next : current;
      });
      markConfirmedMembershipBaselines(
        updated,
        new Set(confirmedMemberships.keys()),
      );
    }

    return summary;
  }

  async reconcileAll(): Promise<SmartPlaylistReconciliationSummary> {
    return this.enqueue(() => this.reconcileNow());
  }

  /** Restore and confirm membership while background sync in either bundle waits. */
  async restoreLibrary<T>(restore: () => Promise<T>): Promise<{ result: T; failedPlaylistNames: string[] }> {
    return this.enqueue(async () => {
      const databaseName = getTagifyDatabaseName();
      const checkAccount = () => {
        if (getTagifyDatabaseName() !== databaseName) {
          throw new Error("Your Spotify account changed. Return to the account where you started importing your backup.");
        }
      };
      const result = await restore();
      checkAccount();
      clearConfirmedMembershipBaselines();
      const playlists = await this.getSmartPlaylists();
      const confirmed = new Map<string, { playlist: SmartPlaylistCriteria; members: string[] }>();
      const failedPlaylistNames: string[] = [];
      for (const playlist of playlists) {
        if (!playlist.playlistId) continue;
        try {
          const members = await spotifyApiService.getAllTrackUrisInPlaylistStrict(playlist.playlistId);
          checkAccount();
          confirmed.set(playlist.playlistId, { playlist, members: uniqueTrackUris(members) });
        } catch (error) {
          checkAccount();
          console.warn("Could not check restored Smart Playlist", playlist.playlistName, error);
          failedPlaylistNames.push(playlist.playlistName);
        }
      }
      checkAccount();
      const confirmedIds = new Set<string>();
      if (confirmed.size) {
        const saved = await this.updateSmartPlaylists((current) => {
          checkAccount();
          return current.map((playlist) => {
            const checked = confirmed.get(playlist.playlistId);
            if (!checked || playlist.id !== checked.playlist.id ||
                playlist.createdAt !== checked.playlist.createdAt ||
                JSON.stringify(playlist.criteria) !== JSON.stringify(checked.playlist.criteria)) return playlist;
            confirmedIds.add(playlist.playlistId);
            return { ...playlist, smartPlaylistTrackUris: checked.members, lastSyncAt: Date.now() };
          });
        });
        checkAccount();
        markConfirmedMembershipBaselines(saved, confirmedIds);
      }
      return { result, failedPlaylistNames };
    });
  }

  async resolveTagChoice(playlistId: string, trackUri: string, choice: TagChoice): Promise<void> {
    return this.enqueue(async () => {
      if (isLocalPersistencePaused()) throw new Error("Your library is updating. Please try again shortly.");
      if (!storageService.isReady()) throw new Error("Your saved Tagify details are still loading. Please try again.");
      await flushLocalPersistence();
      const databaseName = getTagifyDatabaseName();
      const playlist = (await this.getSmartPlaylists()).find((item) => item.playlistId === playlistId);
      if (!playlist?.pendingTagChoices?.includes(trackUri)) return;
      const members = await spotifyApiService.getAllTrackUrisInPlaylistStrict(playlistId);
      if (members.includes(trackUri)) {
        const formula = { clauses: playlist.criteria.includeTagClauses, connectors: playlist.criteria.clauseConnectors };
        // Look up a new song first; the save then starts from the current saved record.
        const details = (await storageService.getTracks([trackUri])).has(trackUri)
          ? undefined
          : await this.fetchNewTrackDetails(trackUri);
        let filtersChanged = false;
        let saved: Record<string, TrackData | null>;
        try {
          saved = await indexedDBStorage.patchTracks({
            [trackUri]: (current) => {
              const base = current
                ? withMissingDetails(current, details)
                : newTrackRecord(trackUri, details, Date.now());
              const tagIds = applyTagChoice(base.tagIds, choice);
              if (!evaluateTagFilterFormula(tagIds, formula)) {
                filtersChanged = true;
                throw new Error("The chosen tags no longer match the playlist filters");
              }
              if (sameTagIds(tagIds, base.tagIds)) return base === current ? undefined : base;
              return { ...base, tagIds, dateModified: Date.now() };
            },
          }, { expectedDatabaseName: databaseName });
        } catch (error) {
          if (filtersChanged) throw new Error("The playlist filters have changed. Please review your choice again.");
          console.error("Tagify: Smart Playlist tag choice could not be saved", error);
          throw new Error("Your tags could not be saved. Please try again.");
        }
        if (Object.keys(saved).length > 0) dispatchTagDataUpdatedEvent("smartPlaylistSync");
      }
      await this.updateSmartPlaylists((current) => current.map((item) => item.playlistId === playlistId
        ? { ...item, pendingTagChoices: item.pendingTagChoices?.filter((uri) => uri !== trackUri) }
        : item));
      await this.reconcileNow(playlist.isActive ? playlistId : undefined);
    });
  }

  async reconcilePlaylist(
    playlistId: string,
  ): Promise<SmartPlaylistReconciliationSummary> {
    return this.enqueue(() => this.reconcileNow(playlistId));
  }

  private async syncTracksNow(
    trackUpdates: Record<string, TrackData | null>,
  ): Promise<void> {
    if (!storageService.isReady() || isLocalPersistencePaused()) {
      return;
    }
    await flushLocalPersistence();

    let playlists = await this.getOrderedActivePlaylists();
    if (playlists.length === 0) {
      return;
    }
    const cancelsChoice = (playlist: SmartPlaylistCriteria, uri: string) => Object.prototype.hasOwnProperty.call(trackUpdates, uri) &&
      (!trackUpdates[uri] || !evaluateTrackMatchesCriteria(trackUpdates[uri]!, { ...playlist.criteria, includeTagClauses: [], clauseConnectors: [] }));
    if (playlists.some((playlist) => playlist.pendingTagChoices?.some((uri) => cancelsChoice(playlist, uri)))) {
      await this.updateSmartPlaylists((current) => current.map((playlist) => ({
        ...playlist, ...(playlist.pendingTagChoices ? { pendingTagChoices: playlist.pendingTagChoices.filter((uri) => !cancelsChoice(playlist, uri)) } : {}),
      })));
      playlists = await this.getOrderedActivePlaylists();
    }

    const membershipByPlaylistId = new Map(
      playlists.map((playlist) => [
        playlist.playlistId,
        uniqueTrackUris(playlist.smartPlaylistTrackUris ?? []),
      ]),
    );
    const currentTracks = new Map<string, TrackData>();
    const recordingTracks = Object.values(trackUpdates).some(data => data?.recordingGroupId)
      ? (await storageService.loadAllStrict()).tracks : {};
    Object.entries(trackUpdates).forEach(([uri, data]) => { if (data) recordingTracks[uri] = data; else delete recordingTracks[uri]; });
    const recordingKeys = recordingDisplayKeys(recordingTracks);
    const addedByPlaylistId = new Map<string, Set<string>>();
    const removedByPlaylistId = new Map<string, Set<string>>();
    const recordChange = (changes: Map<string, Set<string>>, playlistId: string, trackUri: string) => {
      changes.set(playlistId, (changes.get(playlistId) ?? new Set()).add(trackUri));
    };
    let playlistUpdateFailed = false;

    for (const [trackUri, provided] of Object.entries(trackUpdates)) {
      if (provided) {
        currentTracks.set(trackUri, provided);
      }
      const trackData = currentTracks.get(trackUri) ?? null;

      for (const playlist of playlists) {
        const membership = membershipByPlaylistId.get(playlist.playlistId) ?? [];
        const isMember = membership.includes(trackUri);
        const matches = trackData !== null && evaluateTrackMatchesCriteria(trackData, playlist.criteria);
        if (isMember && !matches && !playlist.pendingTagChoices?.includes(trackUri) && hasConfirmedMembershipBaseline(playlist)) {
          if (await spotifyApiService.removeTrackFromPlaylist(trackUri, playlist.playlistId)) {
            membership.splice(membership.indexOf(trackUri), 1);
            recordChange(removedByPlaylistId, playlist.playlistId, trackUri);
          } else playlistUpdateFailed = true;
          continue;
        }
        if (isMember || !matches) {
          continue;
        }
        const recording = recordingKeys.get(trackUri);
        if (recording && membership.some(uri => recordingKeys.get(uri) === recording && recordingTracks[uri] && evaluateTrackMatchesCriteria(recordingTracks[uri], playlist.criteria))) continue;

        const result = await spotifyApiService.addTrackToSpotifyPlaylist(
          trackUri,
          playlist.playlistId,
        );
        if (result.success && result.wasAdded) {
          membership.push(trackUri);
          recordChange(addedByPlaylistId, playlist.playlistId, trackUri);
        }
        if (!result.success) playlistUpdateFailed = true;
      }
    }

    if (playlistUpdateFailed && Date.now() - this.lastFailureNoticeAt >= 60_000) {
      this.lastFailureNoticeAt = Date.now();
      Spicetify.showNotification("Your changes are saved. Smart Playlists will update when Spotify is available.");
    }

    if (addedByPlaylistId.size > 0 || removedByPlaylistId.size > 0) {
      const now = Date.now();
      // Apply only this pass's additions and removals to the membership saved
      // now, so membership recorded meanwhile is never replaced.
      await this.updateSmartPlaylists((current) => {
        const next = current.map((playlist) => {
          const added = addedByPlaylistId.get(playlist.playlistId);
          const removed = removedByPlaylistId.get(playlist.playlistId);
          if (!added && !removed) return playlist;
          return {
            ...playlist,
            smartPlaylistTrackUris: uniqueTrackUris([
              ...(playlist.smartPlaylistTrackUris ?? []).filter((trackUri) => !removed?.has(trackUri)),
              ...(added ?? []),
            ]),
            lastSyncAt: now,
          };
        });
        return next.some((playlist, index) => playlist !== current[index]) ? next : current;
      });
    }
  }

  async syncTrack(trackUri: string, trackData: TrackData | null): Promise<void> {
    return this.enqueue(() =>
      this.syncTracksNow({ [trackUri]: trackData }),
    );
  }

  async syncTracks(
    trackUpdates: Record<string, TrackData | null>,
  ): Promise<void> {
    return this.enqueue(() => this.syncTracksNow(trackUpdates));
  }

  private async handleDesktopPlaylistAdd(
    playlistUri: string,
    trackUris: string[],
  ): Promise<void> {
    const playlistId = playlistUri.split(":").pop();
    if (!playlistId || trackUris.length === 0) {
      return;
    }

    await this.enqueue(async () => {
      if (!storageService.isReady() || isLocalPersistencePaused()) {
        return;
      }
      const playlist = (await this.getSmartPlaylists()).find(
        (candidate) => candidate.playlistId === playlistId && candidate.isActive,
      );
      if (!playlist) {
        return;
      }

      const knownMembers = new Set(playlist.smartPlaylistTrackUris ?? []);
      const additions = uniqueTrackUris(trackUris).filter(
        (trackUri) => !knownMembers.has(trackUri),
      );
      if (additions.length === 0) {
        return;
      }

      await flushLocalPersistence();
      const inbound = await this.applyInboundCriteria(
        [playlist],
        new Map([[playlistId, additions]]),
        getTagifyDatabaseName(),
      );
      if (inbound.notifications.length > 0) {
        try {
          showSmartPlaylistCriteriaAppliedNotifications(
            inbound.notifications,
            await storageService.getTaxonomy(),
          );
        } catch (error) {
          console.error("Tagify: Smart Playlist changes are saved but could not be announced", error);
        }
      }
      // Until the first full check records which songs were already in the
      // playlist, one addition must not stand in for that record: every older
      // song would then look newly added and receive the playlist's criteria.
      if (hasConfirmedMembershipBaseline(playlist)) {
        const updatedPlaylists = await this.updateSmartPlaylists((current) => current.map((candidate) =>
          candidate.playlistId === playlistId
            ? {
                ...candidate,
                smartPlaylistTrackUris: uniqueTrackUris([
                  ...(candidate.smartPlaylistTrackUris ?? []),
                  ...additions,
                ]),
                lastSyncAt: Date.now(),
              }
            : candidate,
        ));
        markConfirmedMembershipBaselines(
          updatedPlaylists,
          new Set([playlistId]),
        );
      }

      const appliedUpdates = Object.fromEntries(
        additions.map((trackUri) => [trackUri, inbound.tracks.get(trackUri) ?? null]),
      );
      await this.syncTracksNow(appliedUpdates);
    });
  }

  private installDesktopAddHook(): void {
    const playlistApi = (Spicetify.Platform.PlaylistAPI ?? null) as DesktopPlaylistApi | null;
    if (
      !playlistApi ||
      typeof playlistApi.add !== "function" ||
      playlistApi[PLAYLIST_API_HOOK_MARKER]
    ) {
      return;
    }

    const originalAdd = playlistApi.add;
    const handleDesktopPlaylistAdd = this.handleDesktopPlaylistAdd.bind(this);
    playlistApi.add = async function (...args: unknown[]) {
      const result = await originalAdd.apply(this, args);
      const [playlistUri, items] = args;
      const trackUris = Array.isArray(items)
        ? items
            .map((item: unknown) => typeof item === "string" ? item :
              item && typeof item === "object" && "uri" in item ? item.uri : null)
            .filter((uri): uri is string => typeof uri === "string")
        : [];
      if (
        typeof playlistUri === "string" &&
        playlistUri.startsWith("spotify:playlist:")
      ) {
        void handleDesktopPlaylistAdd(playlistUri, trackUris)
          .catch((error) =>
            console.error("Immediate smart-playlist reconciliation failed:", error),
          );
      }
      return result;
    };
    playlistApi[PLAYLIST_API_HOOK_MARKER] = true;
  }

  private queueBackgroundReconciliation(): void {
    if (!this.canReconcileAutomatically() || this.backgroundTask) {
      return;
    }
    this.clearReconciliationTimer();
    // Coalesce focus/visibility/timer triggers even while waiting behind a user edit.
    // Recheck visibility when the queued operation actually begins.
    this.backgroundTask = this.enqueue(async () => {
      if (!this.canReconcileAutomatically()) return;
      await this.reconcileNow(undefined, true);
    }).catch((error) => {
      console.error("Background smart-playlist reconciliation failed:", error);
    }).finally(() => {
      this.backgroundTask = null;
      if (this.canReconcileAutomatically()) {
        this.reconciliationTimer = setTimeout(() => {
          this.reconciliationTimer = null;
          this.queueBackgroundReconciliation();
        }, RECONCILIATION_INTERVAL_MS);
      }
    });
  }

  private canReconcileAutomatically(): boolean {
    // Some desktop window managers keep covered Spotify windows "visible".
    return this.backgroundStarted && document.visibilityState !== "hidden" && document.hasFocus();
  }

  private clearReconciliationTimer(): void {
    if (this.reconciliationTimer !== null) {
      clearTimeout(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
  }

  startBackgroundReconciliation(): void {
    if (this.backgroundStarted) {
      return;
    }
    this.backgroundStarted = true;
    this.installDesktopAddHook();
    window.addEventListener("focus", this.handleWindowFocus);
    window.addEventListener("blur", this.handleWindowBlur);
    document.addEventListener("visibilitychange", this.handleVisibilityChange);
    this.queueBackgroundReconciliation();
  }

  stopBackgroundReconciliation(): void {
    if (!this.backgroundStarted) {
      return;
    }
    this.backgroundStarted = false;
    window.removeEventListener("focus", this.handleWindowFocus);
    window.removeEventListener("blur", this.handleWindowBlur);
    document.removeEventListener("visibilitychange", this.handleVisibilityChange);
    this.clearReconciliationTimer();
  }
}

export const smartPlaylistSyncService = new SmartPlaylistSyncService();
