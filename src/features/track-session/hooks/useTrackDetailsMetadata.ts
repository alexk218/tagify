import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SpotifyTrack } from "@/types/SpotifyTypes";
import { TrackTag } from "@/types/tagData";
import { audioFeaturesService } from "@/services/AudioFeaturesService";
import { spotifyService, TrackMetadata } from "@/services/SpotifyService";
import { normalizeCamelotKey } from "@/utils/camelotKey";

export interface TrackDetailsTrackData {
  rating: number;
  energy: number;
  bpm: number | null;
  camelotKey?: string | null;
  tagIds: TrackTag[];
  dateCreated?: number;
  dateModified?: number;
}

export interface ExtendedTrackMetadata extends TrackMetadata {
  bpm: number | null;
  camelotKey: string | null;
  sourceContext: string | null;
}

interface UseTrackDetailsMetadataOptions {
  displayedTrack: SpotifyTrack;
  artistNames: string;
  trackData: TrackDetailsTrackData;
  onSetBpm: (bpm: number | null) => void;
  onSetCamelotKey: (camelotKey: string | null) => void;
}

function createBaseMetadata(sourceContext: string | null): ExtendedTrackMetadata {
  return {
    releaseDate: "",
    trackLength: "",
    bpm: null,
    camelotKey: null,
    playCount: null,
    sourceContext,
    genres: [],
    albumCoverUrl: null,
  };
}

export function useTrackDetailsMetadata({
  displayedTrack,
  artistNames,
  trackData,
  onSetBpm,
  onSetCamelotKey,
}: UseTrackDetailsMetadataOptions) {
  const [contextUri, setContextUri] = useState<string | null>(null);
  const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);
  const [albumCover, setAlbumCover] = useState<string | null>(null);
  const [isLoadingCover, setIsLoadingCover] = useState(true);
  const [trackMetadata, setTrackMetadata] =
    useState<ExtendedTrackMetadata>(createBaseMetadata(null));
  const [isRefreshingAudioFeatures, setIsRefreshingAudioFeatures] =
    useState(false);
  const previousTrackUriRef = useRef<string | null>(null);
  const metadataTrackUriRef = useRef<string | null>(null);
  const onSetBpmRef = useRef(onSetBpm);
  const onSetCamelotKeyRef = useRef(onSetCamelotKey);

  useEffect(() => {
    onSetBpmRef.current = onSetBpm;
  }, [onSetBpm]);

  useEffect(() => {
    onSetCamelotKeyRef.current = onSetCamelotKey;
  }, [onSetCamelotKey]);

  const hasPersistedTrackData = useMemo(
    () =>
      trackData.dateCreated !== undefined ||
      trackData.dateModified !== undefined ||
      trackData.rating > 0 ||
      trackData.energy > 0 ||
      trackData.tagIds.length > 0 ||
      trackData.bpm !== null ||
      normalizeCamelotKey(trackData.camelotKey) !== null,
    [trackData],
  );

  const handleRefreshAudioFeatures = useCallback(async () => {
    if (displayedTrack.uri.startsWith("spotify:local:")) {
      Spicetify.showNotification(
        "Cannot fetch audio features for local files",
        true,
      );
      return;
    }

    setIsRefreshingAudioFeatures(true);

    try {
      const features = await audioFeaturesService.getAudioFeaturesFromUri(
        displayedTrack.uri,
      );
      const bpm = features?.bpm ?? null;
      const camelotKey = normalizeCamelotKey(features?.camelotKey);

      if (bpm === null && camelotKey === null) {
        Spicetify.showNotification(
          "Could not fetch audio features from Spotify",
          true,
        );
        return;
      }

      setTrackMetadata((previous) => ({
        ...previous,
        bpm,
        camelotKey,
      }));
      metadataTrackUriRef.current = displayedTrack.uri;

      if (hasPersistedTrackData) {
        if (bpm !== null) {
          onSetBpmRef.current(bpm);
        }
        if (camelotKey !== null) {
          onSetCamelotKeyRef.current(camelotKey);
        }
      }

      const updatedParts: string[] = [];
      if (bpm !== null) {
        updatedParts.push(`BPM ${bpm}`);
      }
      if (camelotKey !== null) {
        updatedParts.push(`Key ${camelotKey}`);
      }

      Spicetify.showNotification(`Updated ${updatedParts.join(" • ")} from Spotify`);
    } catch (error) {
      console.error("Error refreshing audio features:", error);
      Spicetify.showNotification("Error fetching audio features from Spotify", true);
    } finally {
      setIsRefreshingAudioFeatures(false);
    }
  }, [displayedTrack.uri, hasPersistedTrackData]);

  useEffect(() => {
    let isCancelled = false;
    const isTrackChanged = previousTrackUriRef.current !== displayedTrack.uri;
    previousTrackUriRef.current = displayedTrack.uri;

    if (!isTrackChanged) {
      return () => {
        isCancelled = true;
      };
    }

    const fetchTrackMetadata = async () => {
      setIsLoadingMetadata(true);
      setIsLoadingCover(true);

      try {
        if (displayedTrack.uri.startsWith("spotify:local:")) {
          if (isCancelled) {
            return;
          }

          setContextUri(null);
          setAlbumCover(null);
          setIsLoadingCover(false);
          setTrackMetadata(createBaseMetadata("Local Files"));
          metadataTrackUriRef.current = displayedTrack.uri;
          return;
        }

        const metadata = await spotifyService.getTrackMetadata(displayedTrack.uri);
        if (!metadata) {
          if (isCancelled) {
            return;
          }

          setContextUri(null);
          setAlbumCover(null);
          setIsLoadingCover(false);
          setTrackMetadata(createBaseMetadata(null));
          metadataTrackUriRef.current = displayedTrack.uri;
          return;
        }

        let sourceContext: string | null = null;
        let nextContextUri: string | null = null;

        if (Spicetify.Player?.data?.context?.uri) {
          nextContextUri = Spicetify.Player.data.context.uri;
          const parts = nextContextUri.split(":");

          if (parts.length >= 2) {
            const contextType = parts[1];

            if (contextType === "collection" && parts.includes("tracks")) {
              sourceContext = "Liked Songs";
            } else if (contextType === "user") {
              sourceContext = "Liked Songs";
            } else if (contextType === "album") {
              sourceContext = displayedTrack.album.name;
            } else if (contextType === "artist") {
              sourceContext = artistNames ? artistNames.split(",")[0] : "Artist";
            } else if (contextType === "playlist") {
              sourceContext = await spotifyService.getContextName(nextContextUri);
            }
          }
        }

        let bpm: number | null = trackData.bpm ?? null;
        let camelotKey = normalizeCamelotKey(trackData.camelotKey);

        if (bpm === null || camelotKey === null) {
          try {
            const audioFeatures = await audioFeaturesService.getAudioFeaturesFromUri(
              displayedTrack.uri,
            );
            if (bpm === null) {
              bpm = audioFeatures?.bpm ?? null;
            }
            if (camelotKey === null) {
              camelotKey = normalizeCamelotKey(audioFeatures?.camelotKey);
            }
          } catch (error) {
            console.error("Error auto-fetching audio features:", error);
          }
        }

        if (hasPersistedTrackData) {
          if (trackData.bpm === null && bpm !== null) {
            onSetBpmRef.current(bpm);
          }
          if (
            normalizeCamelotKey(trackData.camelotKey) === null &&
            camelotKey !== null
          ) {
            onSetCamelotKeyRef.current(camelotKey);
          }
        }

        if (isCancelled) {
          return;
        }

        setContextUri(nextContextUri);
        setAlbumCover(metadata.albumCoverUrl);
        setIsLoadingCover(false);
        setTrackMetadata({
          ...metadata,
          bpm,
          camelotKey,
          sourceContext,
        });
        metadataTrackUriRef.current = displayedTrack.uri;
      } catch (error) {
        console.error("Error fetching track metadata:", error);

        if (isCancelled) {
          return;
        }

        setContextUri(null);
        setAlbumCover(null);
        setIsLoadingCover(false);
        setTrackMetadata(createBaseMetadata(null));
        metadataTrackUriRef.current = displayedTrack.uri;
      } finally {
        if (!isCancelled) {
          setIsLoadingMetadata(false);
        }
      }
    };

    if (displayedTrack.uri) {
      void fetchTrackMetadata();
    }

    return () => {
      isCancelled = true;
    };
  }, [
    artistNames,
    displayedTrack.album.name,
    displayedTrack.uri,
  ]);

  useEffect(() => {
    if (!hasPersistedTrackData) {
      return;
    }

    if (metadataTrackUriRef.current !== displayedTrack.uri) {
      return;
    }

    const normalizedTrackKey = normalizeCamelotKey(trackData.camelotKey);

    if (trackData.bpm === null && trackMetadata.bpm !== null) {
      onSetBpmRef.current(trackMetadata.bpm);
    }

    if (normalizedTrackKey === null && trackMetadata.camelotKey !== null) {
      onSetCamelotKeyRef.current(trackMetadata.camelotKey);
    }
  }, [
    displayedTrack.uri,
    hasPersistedTrackData,
    trackData.bpm,
    trackData.camelotKey,
    trackMetadata.bpm,
    trackMetadata.camelotKey,
  ]);

  return {
    contextUri,
    isLoadingMetadata,
    albumCover,
    isLoadingCover,
    trackMetadata,
    isRefreshingAudioFeatures,
    handleRefreshAudioFeatures,
  };
}
