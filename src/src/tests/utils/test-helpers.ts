import { expect, vi } from "vitest";
import { SmartPlaylistCriteria, TrackData, TagCategory, TrackTag } from "@/hooks/data/useTagData";

// Mock data factories for consistent test data
export const createMockTrackData = (overrides: Partial<TrackData> = {}): TrackData => ({
  rating: 4,
  energy: 7,
  bpm: 128,
  tags: [],
  dateCreated: Date.now(),
  dateModified: Date.now(),
  ...overrides,
});

export const createMockSmartPlaylist = (
  overrides: Partial<SmartPlaylistCriteria> = {}
): SmartPlaylistCriteria => ({
  playlistId: `test-playlist-${Date.now()}`,
  playlistName: "Test Playlist",
  isActive: true,
  smartPlaylistTrackUris: [],
  lastSyncAt: Date.now(),
  createdAt: Date.now(),
  criteria: {
    activeTagFilters: [],
    excludedTagFilters: [],
    ratingFilters: [],
    energyMinFilter: null,
    energyMaxFilter: null,
    bpmMinFilter: null,
    bpmMaxFilter: null,
    isOrFilterMode: false,
  },
  ...overrides,
});

export const createMockTagCategory = (overrides: Partial<TagCategory> = {}): TagCategory => ({
  id: "test-category",
  name: "Test Category",
  subcategories: [
    {
      id: "test-subcategory",
      name: "Test Subcategory",
      tags: [{ id: "test-tag", name: "Test Tag" }],
    },
  ],
  ...overrides,
});

export const createMockTrackTag = (overrides: Partial<TrackTag> = {}): TrackTag => ({
  categoryId: "genre",
  subcategoryId: "electronic",
  tagId: "house",
  ...overrides,
});

// Spotify API mock helpers
export const mockSpotifyApiSuccess = () => {
  global.Spicetify = {
    CosmosAsync: {
      get: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      post: vi.fn().mockResolvedValue({ snapshot_id: "test-snapshot" }),
      put: vi.fn().mockResolvedValue({ snapshot_id: "test-snapshot" }),
      del: vi.fn().mockResolvedValue({ snapshot_id: "test-snapshot" }),
      head: vi.fn(),
      patch: vi.fn(),
      sub: vi.fn(),
      postSub: vi.fn(),
      request: vi.fn(),
      resolve: vi.fn(),
    },
    showNotification: vi.fn(),
    Platform: {
      History: {
        push: vi.fn(),
      },
    },
  } as any;
};

export const mockSpotifyApiError = (errorMessage: string = "API Error") => {
  global.Spicetify = {
    CosmosAsync: {
      get: vi.fn().mockRejectedValue(new Error(errorMessage)),
      post: vi.fn().mockRejectedValue(new Error(errorMessage)),
      put: vi.fn().mockRejectedValue(new Error(errorMessage)),
      del: vi.fn().mockRejectedValue(new Error(errorMessage)),
      head: vi.fn(),
      patch: vi.fn(),
      sub: vi.fn(),
      postSub: vi.fn(),
      request: vi.fn(),
      resolve: vi.fn(),
    },
    showNotification: vi.fn(),
    Platform: {
      History: {
        push: vi.fn(),
      },
    },
  } as any;
};

// localStorage mock helpers
export const mockLocalStorageWithData = (data: Record<string, any>) => {
  const mockGetItem = vi.fn((key: string) => {
    return data[key] ? JSON.stringify(data[key]) : null;
  });

  const mockSetItem = vi.fn();

  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: mockGetItem,
      setItem: mockSetItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
    },
  });

  return { mockGetItem, mockSetItem };
};

// Test data sets for comprehensive testing
export const testTagCategories: TagCategory[] = [
  {
    id: "genre",
    name: "Genre",
    subcategories: [
      {
        id: "electronic",
        name: "Electronic",
        tags: [
          { id: "house", name: "House" },
          { id: "techno", name: "Techno" },
          { id: "trance", name: "Trance" },
          { id: "dubstep", name: "Dubstep" },
        ],
      },
      {
        id: "rock",
        name: "Rock",
        tags: [
          { id: "alternative", name: "Alternative" },
          { id: "indie", name: "Indie" },
          { id: "metal", name: "Metal" },
        ],
      },
      {
        id: "pop",
        name: "Pop",
        tags: [
          { id: "mainstream", name: "Mainstream" },
          { id: "synthpop", name: "Synthpop" },
        ],
      },
    ],
  },
  {
    id: "mood",
    name: "Mood",
    subcategories: [
      {
        id: "energy",
        name: "Energy",
        tags: [
          { id: "uplifting", name: "Uplifting" },
          { id: "chill", name: "Chill" },
          { id: "aggressive", name: "Aggressive" },
          { id: "melancholic", name: "Melancholic" },
        ],
      },
      {
        id: "vibe",
        name: "Vibe",
        tags: [
          { id: "party", name: "Party" },
          { id: "romantic", name: "Romantic" },
          { id: "workout", name: "Workout" },
        ],
      },
    ],
  },
];

export const testTrackData: Record<string, TrackData> = {
  "spotify:track:house1": {
    rating: 5,
    energy: 8,
    bpm: 128,
    tags: [
      { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
      { categoryId: "mood", subcategoryId: "energy", tagId: "uplifting" },
    ],
    dateCreated: Date.now() - 86400000,
    dateModified: Date.now() - 3600000,
  },
  "spotify:track:techno1": {
    rating: 4,
    energy: 9,
    bpm: 135,
    tags: [
      { categoryId: "genre", subcategoryId: "electronic", tagId: "techno" },
      { categoryId: "mood", subcategoryId: "energy", tagId: "aggressive" },
    ],
    dateCreated: Date.now() - 172800000,
    dateModified: Date.now() - 7200000,
  },
  "spotify:track:rock1": {
    rating: 3,
    energy: 6,
    bpm: 120,
    tags: [
      { categoryId: "genre", subcategoryId: "rock", tagId: "alternative" },
      { categoryId: "mood", subcategoryId: "energy", tagId: "melancholic" },
    ],
    dateCreated: Date.now() - 259200000,
    dateModified: Date.now() - 10800000,
  },
  "spotify:track:chill1": {
    rating: 4,
    energy: 3,
    bpm: 85,
    tags: [
      { categoryId: "mood", subcategoryId: "energy", tagId: "chill" },
      { categoryId: "mood", subcategoryId: "vibe", tagId: "romantic" },
    ],
    dateCreated: Date.now() - 345600000,
    dateModified: Date.now() - 14400000,
  },
  "spotify:local:test:artist:track:duration": {
    rating: 2,
    energy: 5,
    bpm: null,
    tags: [{ categoryId: "genre", subcategoryId: "pop", tagId: "mainstream" }],
    dateCreated: Date.now() - 432000000,
    dateModified: Date.now() - 18000000,
  },
};

// Smart playlist test scenarios
export const smartPlaylistScenarios = {
  houseOnly: createMockSmartPlaylist({
    playlistId: "house-playlist",
    playlistName: "House Music",
    criteria: {
      activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
      excludedTagFilters: [],
      ratingFilters: [],
      energyMinFilter: null,
      energyMaxFilter: null,
      bpmMinFilter: null,
      bpmMaxFilter: null,
      isOrFilterMode: false,
    },
  }),

  highEnergyElectronic: createMockSmartPlaylist({
    playlistId: "high-energy-playlist",
    playlistName: "High Energy Electronic",
    criteria: {
      activeTagFilters: [
        { categoryId: "genre", subcategoryId: "electronic", tagId: "house" },
        { categoryId: "genre", subcategoryId: "electronic", tagId: "techno" },
      ],
      excludedTagFilters: [],
      ratingFilters: [4, 5],
      energyMinFilter: 7,
      energyMaxFilter: null,
      bpmMinFilter: 120,
      bpmMaxFilter: null,
      isOrFilterMode: true, // OR mode for tags
    },
  }),

  noAggressiveMusic: createMockSmartPlaylist({
    playlistId: "chill-playlist",
    playlistName: "Chill Vibes",
    criteria: {
      activeTagFilters: [],
      excludedTagFilters: [{ categoryId: "mood", subcategoryId: "energy", tagId: "aggressive" }],
      ratingFilters: [],
      energyMinFilter: null,
      energyMaxFilter: 6,
      bpmMinFilter: null,
      bpmMaxFilter: null,
      isOrFilterMode: false,
    },
  }),

  complexCriteria: createMockSmartPlaylist({
    playlistId: "complex-playlist",
    playlistName: "Complex Criteria Mix",
    criteria: {
      activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
      excludedTagFilters: [{ categoryId: "mood", subcategoryId: "energy", tagId: "melancholic" }],
      ratingFilters: [4, 5],
      energyMinFilter: 6,
      energyMaxFilter: 9,
      bpmMinFilter: 120,
      bpmMaxFilter: 140,
      isOrFilterMode: false,
    },
  }),
};

// Assertion helpers
// You should import your actual evaluation function if available
// import { evaluateTrackMatchesCriteria } from "../../hooks/useTagData"; // adjust path if needed

// export const expectTrackToMatchCriteria = (
//   trackData: TrackData,
//   criteria: SmartPlaylistCriteria["criteria"],
//   shouldMatch: boolean = true
// ) => {
//   const matches = evaluateTrackMatchesCriteria(trackData, criteria);
//   expect(matches).toBe(shouldMatch);
// };

// Performance testing helpers
export const createLargeDataset = (trackCount: number = 1000) => {
  const tracks: Record<string, TrackData> = {};

  for (let i = 0; i < trackCount; i++) {
    tracks[`spotify:track:${i}`] = createMockTrackData({
      rating: Math.floor(Math.random() * 5) + 1,
      energy: Math.floor(Math.random() * 10) + 1,
      bpm: Math.floor(Math.random() * 100) + 80,
      tags: [
        createMockTrackTag({
          tagId: ["house", "techno", "trance", "alternative", "indie"][
            Math.floor(Math.random() * 5)
          ],
        }),
      ],
    });
  }

  return tracks;
};

// Error simulation helpers
export const simulateNetworkError = () => {
  global.Spicetify.CosmosAsync.get = vi.fn().mockRejectedValue(new Error("Network error"));
  global.Spicetify.CosmosAsync.post = vi.fn().mockRejectedValue(new Error("Network error"));
  global.Spicetify.CosmosAsync.del = vi.fn().mockRejectedValue(new Error("Network error"));
};

export const simulateRateLimitError = () => {
  global.Spicetify.CosmosAsync.get = vi.fn().mockRejectedValue(new Error("Rate limit exceeded"));
  global.Spicetify.CosmosAsync.post = vi.fn().mockRejectedValue(new Error("Rate limit exceeded"));
  global.Spicetify.CosmosAsync.del = vi.fn().mockRejectedValue(new Error("Rate limit exceeded"));
};

// Custom matchers for better assertions
export const customMatchers = {
  toBeValidSmartPlaylist: (received: SmartPlaylistCriteria) => {
    const hasValidId = typeof received.playlistId === "string" && received.playlistId.length > 0;
    const hasValidName =
      typeof received.playlistName === "string" && received.playlistName.length > 0;
    const hasValidCriteria = received.criteria && typeof received.criteria === "object";

    return {
      pass: hasValidId && hasValidName && hasValidCriteria,
      message: () => `Expected ${received} to be a valid smart playlist`,
    };
  },

  toMatchTrackData: (received: TrackData, expected: Partial<TrackData>) => {
    const matches = Object.keys(expected).every((key) => {
      return received[key as keyof TrackData] === expected[key as keyof TrackData];
    });

    return {
      pass: matches,
      message: () => `Expected track data to match ${JSON.stringify(expected)}`,
    };
  },
};
