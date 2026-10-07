import { RateLimiter } from "@/utils/RateLimiter";
import { normalizeCamelotKey } from "@/utils/camelotKey";
import protobuf from "protobufjs/light";

// Protobuf descriptors for Spotify's extended metadata API
const extendedMetadataJsonDescriptor = {
  nested: {
    Message: {
      fields: {
        header: { type: "Header", id: 1 },
        request: { type: "Request", id: 2, rule: "repeated" },
      },
    },
    Header: {
      fields: {
        country: { type: "string", id: 1 },
        catalogue: { type: "string", id: 2 },
        task_id: { type: "bytes", id: 3 },
      },
    },
    Request: {
      fields: {
        entity_uri: { type: "string", id: 1 },
        query: { type: "Query", id: 2 },
      },
    },
    Query: {
      fields: {
        extension_kind: { type: "uint32", id: 1 },
      },
    },
  },
};

const audioFeaturesJsonDescriptor = {
  nested: {
    Message: {
      fields: {
        header: { type: "Header", id: 1 },
        extension_kind: { type: "uint32", id: 2 },
        response: { type: "Response", id: 3, rule: "repeated" },
      },
    },
    Header: {
      fields: {
        status: { type: "uint32", id: 1 },
      },
    },
    Response: {
      fields: {
        info: { type: "ResponseInfo", id: 1 },
        track: { type: "string", id: 2 },
        attributes: { type: "AudioAttributesWrapper", id: 3, rule: "optional" },
      },
    },
    ResponseInfo: {
      fields: {
        status: { type: "uint32", id: 1 },
      },
    },
    AudioAttributesWrapper: {
      fields: {
        typestr: { type: "string", id: 1 },
        attributes: { type: "AudioAttributes", id: 2 },
      },
    },
    AudioAttributes: {
      fields: {
        bpm: { type: "double", id: 1 },
        key: { type: "Key", id: 2 },
      },
    },
    Key: {
      fields: {
        key: { type: "string", id: 1 },
        majorMinor: { type: "uint32", id: 2 },
        camelot: { type: "CamelotKey", id: 3 },
      },
    },
    CamelotKey: {
      fields: {
        key: { type: "string", id: 1 },
        backgroundColor: { type: "string", id: 2 },
      },
    },
  },
};

const audioFeaturesRateLimiter = new RateLimiter({
  maxRequestsPerSecond: 10,
  maxRequestsPerMinute: 1000,
  circuitBreakerThreshold: 10,
  circuitBreakerResetMs: 30000,
  requestTimeoutMs: 15000,
});

export interface AudioFeatures {
  bpm: number;
  key: string;
  mode: number; // Spotify Web API uses 1 = major, 0 = minor
  camelotKey: string | null;
}

const SPOTIFY_KEY_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const MAJOR_CAMELOT_KEYS = [
  "8B",
  "3B",
  "10B",
  "5B",
  "12B",
  "7B",
  "2B",
  "9B",
  "4B",
  "11B",
  "6B",
  "1B",
] as const;

const MINOR_CAMELOT_KEYS = [
  "5A",
  "12A",
  "7A",
  "2A",
  "9A",
  "4A",
  "11A",
  "6A",
  "1A",
  "8A",
  "3A",
  "10A",
] as const;

// Cache audio features results from TrackDetails -> return that to hooks instead of re-fetching
interface AudioFeaturesCacheEntry {
  features: AudioFeatures | null;
  cachedAt: number;
}

const AUDIO_FEATURES_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_AUDIO_FEATURES_CACHE_ENTRIES = 1000;

export class AudioFeaturesService {
  private extendedMetadataRequest: protobuf.Type | null = null;
  private audioFeaturesResponse: protobuf.Type | null = null;
  private country: string = "US";
  private catalogue: string = "premium";
  private initialized: boolean = false;
  private audioFeaturesCache: Map<string, AudioFeaturesCacheEntry> = new Map();

  private getProtobufTypes() {
    if (!this.extendedMetadataRequest) {
      this.extendedMetadataRequest = protobuf.Root.fromJSON(
        extendedMetadataJsonDescriptor
      ).lookupType("Message");
      this.audioFeaturesResponse = protobuf.Root.fromJSON(
        audioFeaturesJsonDescriptor
      ).lookupType("Message");
    }
    return {
      extendedMetadataRequest: this.extendedMetadataRequest,
      audioFeaturesResponse: this.audioFeaturesResponse,
    };
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    try {
      const productStateValues =
        (await Spicetify.Platform.ProductStateAPI.getValues()) || {};
      this.country = productStateValues["country"] ?? "US";
      this.catalogue = productStateValues["catalogue"] ?? "premium";
      this.initialized = true;
    } catch (error) {
      console.error(
        "AudioFeaturesService: Failed to init product state",
        error
      );
      this.initialized = true; // Continue with defaults
    }
  }

  private async getExtendedMetadata(
    entityUris: string[],
    extensionKind: number
  ): Promise<Uint8Array> {
    const { extendedMetadataRequest } = this.getProtobufTypes();
    if (!extendedMetadataRequest) {
      throw new Error("Protobuf types not initialized");
    }

    const taskId = new Uint8Array(16);
    crypto.getRandomValues(taskId);

    const payload = extendedMetadataRequest
      .encode({
        header: {
          country: this.country,
          catalogue: this.catalogue,
          task_id: taskId,
        },
        request: entityUris.map((entityUri) => ({
          entity_uri: entityUri,
          query: { extension_kind: extensionKind },
        })),
      })
      .finish();
    const payloadBuffer = new ArrayBuffer(payload.byteLength);
    new Uint8Array(payloadBuffer).set(payload);

    const accessToken =
      Spicetify.Platform.AuthorizationAPI.getState().token.accessToken;

    const resp = await fetch(
      "https://spclient.wg.spotify.com/extended-metadata/v0/extended-metadata",
      {
        method: "POST",
        body: payloadBuffer,
        headers: {
          "Content-Type": "application/protobuf",
          Authorization: `Bearer ${accessToken}`,
          "Spotify-App-Version": Spicetify.Platform.version,
          "App-Platform": Spicetify.Platform.PlatformData.app_platform,
        },
      }
    );

    if (!resp.ok) {
      throw new Error(`Extended metadata request failed: ${resp.status}`);
    }

    return new Uint8Array(await resp.arrayBuffer());
  }

  private getCachedAudioFeatures(
    trackId: string
  ): AudioFeatures | null | undefined {
    const entry = this.audioFeaturesCache.get(trackId);
    if (!entry) return undefined;

    if (Date.now() - entry.cachedAt > AUDIO_FEATURES_CACHE_TTL_MS) {
      this.audioFeaturesCache.delete(trackId);
      return undefined;
    }

    return entry.features;
  }

  private setCachedAudioFeatures(
    trackId: string,
    features: AudioFeatures | null
  ): void {
    // Re-insert to keep insertion order as LRU-ish for eviction.
    this.audioFeaturesCache.delete(trackId);
    this.audioFeaturesCache.set(trackId, {
      features,
      cachedAt: Date.now(),
    });

    if (this.audioFeaturesCache.size > MAX_AUDIO_FEATURES_CACHE_ENTRIES) {
      const oldestKey = this.audioFeaturesCache.keys().next().value;
      if (oldestKey) {
        this.audioFeaturesCache.delete(oldestKey);
      }
    }
  }

  private getAccessToken(): string | null {
    return (
      Spicetify.Platform.AuthorizationAPI.getState?.()?.token?.accessToken ||
      null
    );
  }

  private mapSpotifyAudioFeaturesPayload(payload: any): AudioFeatures | null {
    const tempo = payload?.tempo ?? payload?.track?.tempo;
    const key = payload?.key ?? payload?.track?.key;
    const mode = payload?.mode ?? payload?.track?.mode;

    if (typeof tempo !== "number" || tempo <= 0) {
      return null;
    }

    const roundedBpm = Math.round(tempo);
    const keyName =
      typeof key === "number" && key >= 0 && key < SPOTIFY_KEY_NAMES.length
        ? SPOTIFY_KEY_NAMES[key]
        : "Unknown";
    const camelotKey =
      typeof key === "number" && key >= 0 && key < SPOTIFY_KEY_NAMES.length
        ? mode === 1
          ? MAJOR_CAMELOT_KEYS[key]
          : mode === 0
            ? MINOR_CAMELOT_KEYS[key]
            : null
        : null;

    return {
      bpm: roundedBpm,
      key: keyName,
      mode: typeof mode === "number" ? mode : 0,
      camelotKey: normalizeCamelotKey(camelotKey),
    };
  }

  private async getAudioFeaturesFromSpotifyClientApi(
    trackIds: string[]
  ): Promise<(AudioFeatures | null)[]> {
    const accessToken = this.getAccessToken();
    if (!accessToken || trackIds.length === 0) {
      return new Array(trackIds.length).fill(null);
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    return Promise.all(
      trackIds.map(async (trackId) => {
        try {
          const response = await fetch(
            `https://spclient.wg.spotify.com/audio-attributes/v1/audio-analysis/${trackId}`,
            { headers }
          );

          if (!response.ok) {
            console.warn(
              `AudioFeaturesService: Spotify client audio-analysis request failed for ${trackId}: ${response.status}`
            );
            return null;
          }

          return this.mapSpotifyAudioFeaturesPayload(await response.json());
        } catch (error) {
          console.warn(
            `AudioFeaturesService: Spotify client audio-analysis request failed for ${trackId}`,
            error
          );
          return null;
        }
      })
    );
  }

  private async getAudioFeaturesFromWebApi(
    trackIds: string[]
  ): Promise<(AudioFeatures | null)[]> {
    const accessToken = this.getAccessToken();
    if (!accessToken || trackIds.length === 0) {
      return new Array(trackIds.length).fill(null);
    }

    const headers = { Authorization: `Bearer ${accessToken}` };

    try {
      const response = await fetch(
        `https://api.spotify.com/v1/audio-features?ids=${trackIds.join(",")}`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        const audioFeatures = Array.isArray(data?.audio_features)
          ? data.audio_features
          : [];

        return trackIds.map((_, index) =>
          this.mapSpotifyAudioFeaturesPayload(audioFeatures[index])
        );
      }

      console.warn(
        `AudioFeaturesService: Spotify Web API audio-features request failed: ${response.status}`
      );
    } catch (error) {
      console.warn(
        "AudioFeaturesService: Spotify Web API audio-features request failed",
        error
      );
    }

    return Promise.all(
      trackIds.map(async (trackId) => {
        try {
          const response = await fetch(
            `https://api.spotify.com/v1/audio-analysis/${trackId}`,
            { headers }
          );

          if (!response.ok) {
            console.warn(
              `AudioFeaturesService: Spotify Web API audio-analysis request failed for ${trackId}: ${response.status}`
            );
            return null;
          }

          return this.mapSpotifyAudioFeaturesPayload(await response.json());
        } catch (error) {
          console.warn(
            `AudioFeaturesService: Spotify Web API audio-analysis request failed for ${trackId}`,
            error
          );
          return null;
        }
      })
    );
  }

  /**
   * Fetch audio features (BPM, key, mode) for one or more tracks
   * @param trackIds Array of Spotify track IDs (not URIs)
   */
  async getAudioFeatures(
    trackIds: string[]
  ): Promise<(AudioFeatures | null)[]> {
    const results: (AudioFeatures | null)[] = new Array(trackIds.length).fill(
      null
    );
    const missingIndexesByTrackId = new Map<string, number[]>();

    trackIds.forEach((trackId, index) => {
      const cached = this.getCachedAudioFeatures(trackId);
      if (cached !== undefined) {
        results[index] = cached;
        return;
      }

      const indexes = missingIndexesByTrackId.get(trackId);
      if (indexes) {
        indexes.push(index);
      } else {
        missingIndexesByTrackId.set(trackId, [index]);
      }
    });

    const missingTrackIds = Array.from(missingIndexesByTrackId.keys());
    if (missingTrackIds.length === 0) {
      return results;
    }

    // Create a stable key for deduping the same batch, regardless of call order.
    const cacheKey = `audioFeatures:${[...missingTrackIds].sort().join(",")}`;

    const fetched = await audioFeaturesRateLimiter.execute(cacheKey, async () =>
      this.getAudioFeaturesInternal(missingTrackIds)
    );

    missingTrackIds.forEach((trackId, index) => {
      const features = fetched[index] ?? null;
      this.setCachedAudioFeatures(trackId, features);

      const positions = missingIndexesByTrackId.get(trackId) || [];
      positions.forEach((position) => {
        results[position] = features;
      });
    });

    return results;
  }

  /**
   * Fetch BPM for a single track
   * @param trackId Spotify track ID (not URI)
   */
  async getBpm(trackId: string): Promise<number | null> {
    const cached = this.getCachedAudioFeatures(trackId);
    if (cached !== undefined) {
      return cached?.bpm ?? null;
    }

    try {
      const features = await this.getAudioFeaturesByTrackId(trackId);
      return features?.bpm ?? null;
    } catch (error) {
      console.error("AudioFeaturesService: Failed to get BPM", error);
      throw error;
    }
  }

  async getAudioFeaturesByTrackId(trackId: string): Promise<AudioFeatures | null> {
    const [features] = await this.getAudioFeatures([trackId]);
    return features ?? null;
  }

  /**
   * Internal method that does the actual fetch (called by rate limiter)
   */
  private async getAudioFeaturesInternal(
    trackIds: string[]
  ): Promise<(AudioFeatures | null)[]> {
    await this.init();

    const { audioFeaturesResponse } = this.getProtobufTypes();
    if (!audioFeaturesResponse) {
      throw new Error("Protobuf types not initialized");
    }

    const trackUris = trackIds.map((id) => `spotify:track:${id}`);

    let results: (AudioFeatures | null)[] = new Array(trackIds.length).fill(null);

    try {
      // Extension kind 222 = audio features in Spotify's extended metadata API.
      const buf = await this.getExtendedMetadata(trackUris, 222);
      const msg = audioFeaturesResponse.decode(buf) as any;
      const responses = Array.isArray(msg.response) ? msg.response : [];

      results = trackIds.map((_, index) => {
        const attributes = responses[index]?.attributes?.attributes;
        if (!attributes) return null;

        return {
          bpm: Math.round(attributes.bpm),
          key: attributes.key?.key || "Unknown",
          mode: attributes.key?.majorMinor || 0,
          camelotKey: normalizeCamelotKey(attributes.key?.camelot?.key),
        };
      });
    } catch (error) {
      console.warn(
        "AudioFeaturesService: Extended metadata audio features failed, trying Spotify client audio-analysis fallback",
        error
      );
    }

    const missingIndexes = results
      .map((features, index) => (features === null ? index : -1))
      .filter((index) => index >= 0);

    if (missingIndexes.length > 0) {
      const fallbackTrackIds = missingIndexes.map((index) => trackIds[index]);
      let fallbackResults =
        await this.getAudioFeaturesFromSpotifyClientApi(fallbackTrackIds);

      if (fallbackResults.some((features) => features === null)) {
        const webApiTrackIds = fallbackTrackIds.filter(
          (_, index) => fallbackResults[index] === null
        );
        const webApiResults = await this.getAudioFeaturesFromWebApi(webApiTrackIds);
        let webApiIndex = 0;

        fallbackResults = fallbackResults.map((features) =>
          features ?? webApiResults[webApiIndex++] ?? null
        );
      }

      missingIndexes.forEach((originalIndex, fallbackIndex) => {
        results[originalIndex] = fallbackResults[fallbackIndex] ?? null;
      });
    }

    return results;
  }

  /**
   * Fetch BPM for a single track by URI
   * @param trackUri Spotify track URI (spotify:track:xxx)
   */
  async getBpmFromUri(trackUri: string): Promise<number | null> {
    if (trackUri.startsWith("spotify:local:")) {
      return null;
    }

    const trackId = trackUri.split(":").pop();
    if (!trackId) return null;

    return this.getBpm(trackId);
  }

  /**
   * Fetch full audio features for a single track by URI
   * @param trackUri Spotify track URI (spotify:track:xxx)
   */
  async getAudioFeaturesFromUri(trackUri: string): Promise<AudioFeatures | null> {
    if (trackUri.startsWith("spotify:local:")) {
      return null;
    }

    const trackId = trackUri.split(":").pop();
    if (!trackId) {
      return null;
    }

    return this.getAudioFeaturesByTrackId(trackId);
  }
}

export const audioFeaturesService = new AudioFeaturesService();
export { audioFeaturesRateLimiter };
