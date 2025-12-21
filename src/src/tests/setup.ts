import "@testing-library/jest-dom";
import { afterEach, beforeEach, vi } from "vitest";

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

afterEach(() => {
  vi.clearAllMocks();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();
});

// Mock Spicetify globals
global.Spicetify = {
  CosmosAsync: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
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

// Mock custom events
global.CustomEvent = class CustomEvent extends Event {
  detail: any;
  constructor(type: string, options?: CustomEventInit) {
    super(type, options);
    this.detail = options?.detail;
  }
} as any;

interface CustomEventInit extends EventInit {
  detail?: any;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
  localStorageMock.clear.mockClear();

  // Suppress console.error for expected error tests
  const originalError = console.error;
  console.error = vi.fn((message) => {
    if (
      typeof message === "string" &&
      (message.includes("Error fetching") ||
        message.includes("Error creating") ||
        message.includes("Error removing"))
    ) {
      return; // Suppress expected errors
    }
    originalError(message);
  });
});
