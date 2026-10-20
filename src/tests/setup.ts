import { afterEach, beforeEach, vi } from "vitest";

// Test files that never touch the DOM opt into the faster node environment with a
// `// @vitest-environment node` comment. They get the same storage and Spicetify mocks, without
// loading jsdom or the DOM-only setup.
const { cleanup } = typeof document !== "undefined" ? await import("./setupDom") : { cleanup: () => {} };

const storage = new Map<string, string>();

const localStorageMock = {
  getItem: vi.fn((key: string) => (storage.has(key) ? storage.get(key)! : null)),
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    storage.delete(key);
  }),
  clear: vi.fn(() => {
    storage.clear();
    (globalThis as any).__tagifyBackgroundPolicyV1?.clear();
    (globalThis as any).__tagifyRequestAccountingV1?.reset();
    (globalThis as any).__tagifyPlaylistVersionsV1?.clear();
  }),
  key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
  get length() {
    return storage.size;
  },
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

const spicetifyMock = {
  showNotification: vi.fn(),
  addToQueue: vi.fn(),
  Player: {
    data: null,
    isPlaying: vi.fn(() => false),
    playUri: vi.fn(),
    next: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  },
  Platform: {
    username: "test-user",
    version: "test-version",
    PlatformData: { app_platform: "web_player" },
    History: {
      push: vi.fn(),
      listen: vi.fn(() => vi.fn()),
      location: {
        pathname: "/tagify",
        search: "",
      },
    },
    ProductStateAPI: {
      getValues: vi.fn().mockResolvedValue({}),
    },
    AuthorizationAPI: {
      getState: vi.fn(() => ({
        token: {
          accessToken: "test-token",
        },
      })),
    },
    PlaylistAPI: {
      getMetadata: vi.fn(),
      add: vi.fn(),
      remove: vi.fn(),
      updateDetails: vi.fn(async () => undefined),
      _builder: {
        _accessToken: "test-token",
      },
    },
    RootlistAPI: {
      createPlaylist: vi.fn(),
      remove: vi.fn(async () => undefined),
    },
    PlaylistPermissionsAPI: {
      setBasePermission: vi.fn(async () => undefined),
      getBasePermission: vi.fn(async () => "BLOCKED"),
    },
    LibraryAPI: {
      getTracks: vi.fn().mockResolvedValue([]),
      // Spotify answers one boolean per URI.
      contains: vi.fn(async (...uris: string[]) => uris.map(() => false)),
      add: vi.fn(async () => undefined),
    },
  },
  GraphQL: {
    Definitions: {},
    Request: vi.fn(),
  },
  Locale: {
    getLocale: vi.fn(() => "en"),
  },
};

Object.defineProperty(globalThis, "Spicetify", {
  value: spicetifyMock,
  writable: true,
  configurable: true,
});

if (!URL.createObjectURL) {
  Object.defineProperty(URL, "createObjectURL", {
    value: vi.fn(() => "blob:mock-url"),
    writable: true,
    configurable: true,
  });
}

if (!URL.revokeObjectURL) {
  Object.defineProperty(URL, "revokeObjectURL", {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  storage.clear();
  (globalThis as any).__tagifyBackgroundPolicyV1?.clear();
  (globalThis as any).__tagifyRequestAccountingV1?.reset();
  (globalThis as any).__tagifyPlaylistVersionsV1?.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
  localStorageMock.key.mockClear();
});

afterEach(() => {
  cleanup();
  (globalThis as any).__tagifySpotifyRequestsV1?.reset();
  (globalThis as any).__tagifySmartPlaylistSchedulesV1?.clear();
  (globalThis as any).__tagifyPendingWritesV1?.clear();
  delete (globalThis as any).__tagifySpotifyRecoveryNoticeAt;
  const versions = (globalThis as any).__tagifyReadVersionsV2;
  if (versions) { versions.epoch++; versions.resources.clear(); }
});
