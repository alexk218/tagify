import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

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
  }),
  key: vi.fn((index: number) => Array.from(storage.keys())[index] ?? null),
  get length() {
    return storage.size;
  },
};

Object.defineProperty(window, "localStorage", {
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
      _builder: {
        _accessToken: "test-token",
      },
    },
    RootlistAPI: {
      createPlaylist: vi.fn(),
    },
    LibraryAPI: {
      getTracks: vi.fn().mockResolvedValue([]),
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

if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

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

if (!HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}

beforeEach(() => {
  storage.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
  localStorageMock.key.mockClear();
});

afterEach(() => {
  cleanup();
});
