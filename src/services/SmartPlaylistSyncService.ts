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
  updateSmartPlaylistsInStorage,
} from "@/features/smart-playlists/utils/smartPlaylist.storage";
import { dispatchTagDataUpdatedEvent } from "@/features/tag-data/utils/tagData.events";
import { spotifyApiService } from "@/services/SpotifyApiService";
import { spotifyService } from "@/services/SpotifyService";
import { storageService } from "@/services/storage/StorageService";
import {
  flushLocalPersistence,
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

export class SmartPlaylistSyncService {
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
    const result = this.operationQueue.then(operation, operation);
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

  private async createInitialTrackData(trackUri: string): Promise<TrackData> {
    const now = Date.now();
    let name: string | undefined;
    let artists: string | undefined;
    let bpm: number | null = null;
    let camelotKey: string | null = null;

    if (trackUri.startsWith("spotify:local:")) {
      const [, , localArtist, , localTrackName] = trackUri.split(":");
      try {
        name = localTrackName ? decodeURIComponent(localTrackName) : undefined;
        artists = localArtist ? decodeURIComponent(localArtist) : undefined;
      } catch {
        name = localTrackName || undefined;
        artists = localArtist || undefined;
      }
    } else {
      const [metadataResult, audioFeaturesResult] = await Promise.allSettled([
        spotifyService.getTrack(trackUri),
        spotifyApiService.fetchAudioFeatures(trackUri),
      ]);

      if (metadataResult.status === "fulfilled" && metadataResult.value) {
        name = metadataResult.value.name;
        artists = metadataResult.value.artists;
      }
      if (audioFeaturesResult.status === "fulfilled") {
        bpm = audioFeaturesResult.value.bpm;
        camelotKey = audioFeaturesResult.value.camelotKey;
      }
    }

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

  private applyCriteriaForMemberships(
    trackData: TrackData,
    trackUri: string,
    playlists: SmartPlaylistCriteria[],
    membershipByPlaylistId: Map<string, string[]>,
  ): TrackData {
    const now = Date.now();
    const updated = playlists.reduce((current, playlist) => {
      const membership = membershipByPlaylistId.get(playlist.playlistId) ?? [];
      return membership.includes(trackUri)
        ? applySmartPlaylistCriteriaToTrack(current, playlist.criteria, now)
        : current;
    }, trackData);

    const mutableCriteriaUnchanged =
      updated.rating === trackData.rating &&
      updated.energy === trackData.energy &&
      updated.tagIds.length === trackData.tagIds.length &&
      updated.tagIds.every((tagId, index) => tagId === trackData.tagIds[index]);

    if (mutableCriteriaUnchanged) {
      return trackData;
    }

    return {
      ...updated,
      dateCreated: trackData.dateCreated || now,
      dateModified: now,
    };
  }

  private async applyInboundCriteria(
    playlists: SmartPlaylistCriteria[],
    membershipByPlaylistId: Map<string, string[]>,
    providedTrackData: Record<string, TrackData | null> = {},
  ): Promise<{
    updatedCount: number;
    tracks: Map<string, TrackData>;
    notifications: SmartPlaylistAppliedCriteriaNotification[];
  }> {
    const memberTrackUris = uniqueTrackUris(
      Array.from(membershipByPlaylistId.values()).flat(),
    );
    const missingUris = memberTrackUris.filter((uri) => !Object.prototype.hasOwnProperty.call(providedTrackData, uri));
    const stored = missingUris.length ? await storageService.loadAllStrict() : null;
    const storedTracks = new Map(missingUris.flatMap((uri) => stored?.tracks[uri] ? [[uri, stored.tracks[uri]] as const] : []));
    const pending = new Map<string, Set<string>>();
    const tracksToSave = new Map<string, TrackData>();
    const notifications: SmartPlaylistAppliedCriteriaNotification[] = [];

    for (const trackUri of memberTrackUris) {
      const hasProvidedTrackData = Object.prototype.hasOwnProperty.call(
        providedTrackData,
        trackUri,
      );
      const provided = providedTrackData[trackUri];
      const existing = hasProvidedTrackData
        ? provided
        : storedTracks.get(trackUri) ?? null;
      const initial = existing ?? (await this.createInitialTrackData(trackUri));
      if (existing) {
        storedTracks.set(trackUri, existing);
      }
      const updated = this.applyCriteriaForMemberships(
        initial,
        trackUri,
        playlists,
        membershipByPlaylistId,
      );

      for (const playlist of playlists) {
        if (!(membershipByPlaylistId.get(playlist.playlistId) ?? []).includes(trackUri)) continue;
        const choices = smartPlaylistTagChoices(updated.tagIds, playlist.criteria);
        if (!choices || choices.length > 1) {
          const uris = pending.get(playlist.playlistId) ?? new Set<string>();
          uris.add(trackUri);
          pending.set(playlist.playlistId, uris);
        }
      }
      if (updated !== initial || [...pending.values()].some((uris) => uris.has(trackUri))) {
        tracksToSave.set(trackUri, updated);
        storedTracks.set(trackUri, updated);
        notifications.push({
          trackName: updated.name,
          artists: updated.artists,
          playlistNames: playlists
            .filter((playlist) =>
              (membershipByPlaylistId.get(playlist.playlistId) ?? []).includes(
                trackUri,
              ),
            )
            .map((playlist) => playlist.playlistName),
          addedTagIds: updated.tagIds.filter(
            (tagId) => !initial.tagIds.includes(tagId),
          ),
          removedTagIds: initial.tagIds.filter(
            (tagId) => !updated.tagIds.includes(tagId),
          ),
          ...(updated.rating !== initial.rating
            ? { rating: updated.rating }
            : {}),
          ...(updated.energy !== initial.energy
            ? { energy: updated.energy }
            : {}),
        });
      }
    }

    // Persist the pending choice before advancing the membership baseline.
    if (pending.size) await this.updateSmartPlaylists((current) => current.map((playlist) => {
      const uris = pending.get(playlist.playlistId);
      return uris ? { ...playlist, pendingTagChoices: [...new Set([...(playlist.pendingTagChoices ?? []), ...uris])] } : playlist;
    }));
    if (tracksToSave.size > 0) {
      const saved = await storageService.saveTracks(tracksToSave);
      if (!saved) {
        throw new Error("Failed to persist smart-playlist track criteria");
      }
      dispatchTagDataUpdatedEvent("smartPlaylistSync");
    }

    return {
      updatedCount: tracksToSave.size,
      tracks: storedTracks,
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

    const playlists = (await this.getOrderedActivePlaylists()).filter(
      (playlist) => !targetPlaylistId || playlist.playlistId === targetPlaylistId,
    );
    if (playlists.length === 0) {
      if (targetPlaylistId) {
        throw new Error("Smart playlist is no longer active or available");
      }
      return summary;
    }

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
        const previousMembership = new Set(
          uniqueTrackUris(playlist.smartPlaylistTrackUris ?? []),
        );
        inboundAdditionsByPlaylistId.set(
          playlist.playlistId,
          hasConfirmedMembershipBaseline(playlist)
            ? uniqueTrackUris(deduplicated.trackUris).filter(
                (trackUri) => !previousMembership.has(trackUri),
              )
            : [],
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

    const inbound = await this.applyInboundCriteria(
      playlists,
      inboundAdditionsByPlaylistId,
      Object.fromEntries(Array.from(inboundAdditionsByPlaylistId.values()).flat().map((uri) => [uri, allTagData.tracks[uri] ?? null])),
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
          if (background && !membershipChanged && !choicesChanged && !writtenPlaylistIds.has(playlist.playlistId)) {
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

  async resolveTagChoice(playlistId: string, trackUri: string, choice: TagChoice): Promise<void> {
    return this.enqueue(async () => {
      if (isLocalPersistencePaused()) throw new Error("Your library is updating. Please try again shortly.");
      await flushLocalPersistence();
      const playlist = (await this.getSmartPlaylists()).find((item) => item.playlistId === playlistId);
      if (!playlist?.pendingTagChoices?.includes(trackUri)) return;
      const members = await spotifyApiService.getAllTrackUrisInPlaylistStrict(playlistId);
      if (members.includes(trackUri)) {
        const data = await storageService.loadAllStrict();
        const previous = data.tracks[trackUri] ?? await this.createInitialTrackData(trackUri);
        const tagIds = applyTagChoice(previous.tagIds, choice);
        if (!evaluateTagFilterFormula(tagIds, { clauses: playlist.criteria.includeTagClauses, connectors: playlist.criteria.clauseConnectors })) {
          throw new Error("The playlist filters have changed. Please review your choice again.");
        }
        if (!(await storageService.saveTracks(new Map([[trackUri, { ...previous, tagIds, dateModified: Date.now() }]])))) {
          throw new Error("Your tags could not be saved. Please try again.");
        }
        dispatchTagDataUpdatedEvent("smartPlaylistSync");
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
    let membershipChanged = false;
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
            membershipChanged = true;
          } else playlistUpdateFailed = true;
          continue;
        }
        if (isMember || !matches) {
          continue;
        }

        const result = await spotifyApiService.addTrackToSpotifyPlaylist(
          trackUri,
          playlist.playlistId,
        );
        if (result.success && result.wasAdded) {
          membership.push(trackUri);
          membershipChanged = true;
        }
        if (!result.success) playlistUpdateFailed = true;
      }
    }

    if (playlistUpdateFailed && Date.now() - this.lastFailureNoticeAt >= 60_000) {
      this.lastFailureNoticeAt = Date.now();
      Spicetify.showNotification("Your changes are saved. Smart Playlists will update when Spotify is available.");
    }

    if (membershipChanged) {
      const now = Date.now();
      await this.updateSmartPlaylists((current) => current.map((playlist) => {
        const membership = membershipByPlaylistId.get(playlist.playlistId);
        return membership
          ? {
              ...playlist,
              smartPlaylistTrackUris: membership,
              lastSyncAt: now,
            }
          : playlist;
      }));
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
      const playlists = await this.getSmartPlaylists();
      const playlist = playlists.find(
        (candidate) => candidate.playlistId === playlistId && candidate.isActive,
      );
      if (!playlist || isLocalPersistencePaused()) {
        return;
      }

      const additions = uniqueTrackUris(trackUris).filter(
        (trackUri) =>
          !(playlist.smartPlaylistTrackUris ?? []).includes(trackUri),
      );
      if (additions.length === 0) {
        return;
      }

      const updates: Record<string, TrackData | null> = {};
      const allTagData = await storageService.loadAllStrict();
      const stored = new Map(Object.entries(allTagData.tracks));
      additions.forEach((trackUri) => {
        updates[trackUri] = stored.get(trackUri) ?? null;
      });
      const inbound = await this.applyInboundCriteria(
        playlists,
        new Map([[playlistId, additions]]),
        updates,
      );
      showSmartPlaylistCriteriaAppliedNotifications(
        inbound.notifications,
        allTagData.taxonomy,
      );
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

      const appliedUpdates = Object.fromEntries(
        additions.map((trackUri) => [
          trackUri,
          inbound.tracks.get(trackUri) ?? updates[trackUri],
        ]),
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
