# Tagify Smart Playlist Testing Suite

This directory contains comprehensive test coverage for the Tagify smart playlist functionality using Vitest.

## Test Structure

```
src/tests/
├── components/           # React component tests
├── hooks/               # Custom hook tests (core business logic)
├── services/            # Service layer tests (API interactions)
├── integration/         # End-to-end workflow tests
├── performance/         # Performance and load tests
├── edge-cases/          # Edge cases and error handling
├── utils/               # Test utilities and helpers
├── setup.ts             # Global test configuration
└── README.md           # This file
```

## Running Tests

### Basic Commands

```bash
# Run all tests
npm run test

# Run tests with UI
npm run test:ui

# Run tests once (CI mode)
npm run test:run

# Run with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Targeted Test Runs

```bash
# Test specific functionality
npm run test:smart-playlist    # Core smart playlist logic
npm run test:components        # React components
npm run test:services          # API services

# Test specific files
npm test useTagData.test.ts
npm test SmartPlaylistModal.test.tsx
```

## Test Categories

### 1. Unit Tests (`hooks/`, `services/`)

**Coverage**: Core business logic and API interactions

**Key areas tested**:

- Smart playlist criteria evaluation
- Track matching algorithms
- Spotify API service methods
- localStorage operations
- Error handling

**Example**:

```typescript
// Test smart playlist criteria evaluation
it("should evaluate track matches criteria with tag filters", () => {
  const trackData = createMockTrackData({
    tags: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
  });

  const criteria = {
    activeTagFilters: [{ categoryId: "genre", subcategoryId: "electronic", tagId: "house" }],
    // ... other criteria
  };

  const matches = evaluateTrackMatchesCriteria(trackData, criteria);
  expect(matches).toBe(true);
});
```

### 2. Component Tests (`components/`)

**Coverage**: React component behavior and user interactions

**Key areas tested**:

- Rendering with various props
- User interactions (clicks, form input)
- State management
- Event handling
- Accessibility

**Example**:

```typescript
// Test smart playlist modal interactions
it("should toggle playlist active state", async () => {
  const user = userEvent.setup();
  render(<SmartPlaylistModal {...mockProps} />);

  const toggleButton = screen.getByRole("button", { name: /activate/i });
  await user.click(toggleButton);

  expect(mockOnUpdateSmartPlaylists).toHaveBeenCalled();
});
```

### 3. Integration Tests (`integration/`)

**Coverage**: Complete workflows from start to finish

**Key areas tested**:

- Smart playlist creation → track sync workflow
- Multiple playlist management
- Error recovery scenarios
- API failure handling

**Example**:

```typescript
// Test complete smart playlist workflow
it("should create smart playlist and automatically sync new tracks", async () => {
  // 1. Create smart playlist
  // 2. Add matching track
  // 3. Verify track was added to playlist
  // 4. Add non-matching track
  // 5. Verify track was not added
  // 6. Update track to no longer match
  // 7. Verify track was removed
});
```

### 4. Performance Tests (`performance/`)

**Coverage**: Performance benchmarks and stress tests

**Key areas tested**:

- Large dataset handling (1000+ tracks)
- Multiple smart playlist performance
- Memory usage optimization
- API rate limiting simulation

**Example**:

```typescript
// Test performance with large datasets
it("should handle 1000 tracks efficiently", async () => {
  const largeTrackSet = createLargeDataset(1000);

  const startTime = performance.now();
  // ... perform operations
  const endTime = performance.now();

  expect(endTime - startTime).toBeLessThan(100); // Should complete in <100ms
});
```

### 5. Edge Case Tests (`edge-cases/`)

**Coverage**: Error conditions and boundary scenarios

**Key areas tested**:

- Network failures
- Corrupted data recovery
- Concurrent operations
- Boundary values
- Unicode handling

## Test Utilities (`utils/test-helpers.ts`)

### Mock Data Factories

```typescript
// Create consistent test data
const trackData = createMockTrackData({
  rating: 5,
  energy: 8,
  tags: [
    /* custom tags */
  ],
});

const smartPlaylist = createMockSmartPlaylist({
  criteria: {
    activeTagFilters: [
      /* custom filters */
    ],
  },
});
```

### Mock Helpers

```typescript
// Mock successful Spotify API responses
mockSpotifyApiSuccess();

// Mock API errors
mockSpotifyApiError("Network timeout");

// Mock localStorage with data
mockLocalStorageWithData({
  "tagify:smartPlaylists": [mockPlaylist],
});
```

### Test Data Sets

Pre-defined test data for consistent testing:

- `testTagCategories`: Complete tag category structure
- `testTrackData`: Various track data scenarios
- `smartPlaylistScenarios`: Common playlist configurations

## Mocking Strategy

### Spicetify API Mocking

```typescript
// Global Spicetify mock in setup.ts
global.Spicetify = {
  CosmosAsync: {
    get: vi.fn(),
    post: vi.fn(),
    // ...
  },
  showNotification: vi.fn(),
  Platform: {
    History: { push: vi.fn() },
  },
};
```

### Service Mocking

```typescript
// Mock SpotifyApiService
vi.mock("../../services/SpotifyApiService", () => ({
  spotifyApiService: {
    addTrackToSpotifyPlaylist: vi.fn(),
    removeTrackFromPlaylist: vi.fn(),
    // ...
  },
}));
```

### localStorage Mocking

```typescript
// Automatic localStorage mock in setup.ts
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  // ...
};
Object.defineProperty(window, "localStorage", { value: localStorageMock });
```

## Coverage Goals

### Target Coverage Metrics

- **Overall**: 90%+ line coverage
- **Core Logic**: 95%+ (useTagData.ts, criteria evaluation)
- **Components**: 85%+ (UI interactions, rendering)
- **Services**: 90%+ (API calls, error handling)

### Critical Paths (100% Coverage Required)

- Smart playlist criteria evaluation logic
- Track sync operations (add/remove)
- localStorage data persistence
- Error handling for API failures
- User input validation

### Coverage Reports

```bash
# Generate detailed coverage report
npm run test:coverage

# View coverage in browser
open coverage/index.html
```

## Testing Best Practices

### 1. Test Structure (AAA Pattern)

```typescript
it("should perform expected behavior", async () => {
  // Arrange - Set up test data and mocks
  const { result } = renderHook(() => useTagData());
  const mockData = createMockTrackData();

  // Act - Perform the action being tested
  await act(async () => {
    await result.current.syncSingleTrackWithSmartPlaylists("uri", mockData);
  });

  // Assert - Verify the expected outcome
  expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
    "uri",
    expect.any(String)
  );
});
```

### 2. Descriptive Test Names

```typescript
// Good: Describes what should happen
it("should add track to smart playlist when track matches all criteria");

// Bad: Vague description
it("should work correctly");
```

### 3. Test Isolation

```typescript
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // Reset any global state
});
```

### 4. Mock Verification

```typescript
// Verify interactions occurred
expect(spotifyApiService.addTrackToSpotifyPlaylist).toHaveBeenCalledWith(
  "spotify:track:123",
  "playlist-id"
);

// Verify no unexpected interactions
expect(spotifyApiService.removeTrackFromPlaylist).not.toHaveBeenCalled();
```

### 5. Error Testing

```typescript
// Test error conditions explicitly
it("should handle API errors gracefully", async () => {
  vi.mocked(spotifyApiService.addTrackToSpotifyPlaylist).mockRejectedValue(new Error("API Error"));

  // Should not throw
  await expect(syncOperation()).resolves.not.toThrow();
});
```

## Debugging Tests

### VS Code Configuration

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Vitest Tests",
      "type": "node",
      "request": "launch",
      "program": "${workspaceFolder}/node_modules/vitest/vitest.mjs",
      "args": ["run", "--reporter=verbose"],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

### Debug Single Test

```bash
# Run specific test with debugging
npm test -- --reporter=verbose useTagData.test.ts
```

### Console Debugging

```typescript
it("debug test", () => {
  console.log("Debug info:", JSON.stringify(result, null, 2));
  // Use console.log for debugging during development
});
```

## Continuous Integration

### GitHub Actions Example

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "18"
      - run: npm ci
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
        with:
          file: ./coverage/lcov.info
```

## Performance Testing

### Benchmarking

```typescript
// Measure operation performance
const startTime = performance.now();
await performOperation();
const endTime = performance.now();

expect(endTime - startTime).toBeLessThan(expectedDuration);
```

### Memory Testing

```typescript
// Test for memory leaks
const initialMemory = process.memoryUsage().heapUsed;
// Perform operations that might leak
const finalMemory = process.memoryUsage().heapUsed;
expect(finalMemory - initialMemory).toBeLessThan(threshold);
```

### Load Testing

```typescript
// Test with large datasets
const largeDataset = createLargeDataset(1000);
// Verify performance doesn't degrade significantly
```

## Test Data Management

### Fixtures

Store complex test data in separate files:

```typescript
// fixtures/smart-playlists.ts
export const complexSmartPlaylist = {
  playlistId: "complex-test",
  criteria: {
    // ... complex criteria
  },
};
```

### Factories vs Fixtures

- **Factories**: Dynamic test data generation (preferred)
- **Fixtures**: Static test data files (for complex scenarios)

```typescript
// Factory (flexible)
const playlist = createMockSmartPlaylist({
  criteria: customCriteria,
});

// Fixture (static)
import { complexPlaylistFixture } from "./fixtures";
```

## Common Testing Patterns

### Testing Async Operations

```typescript
// Use act() for state updates
await act(async () => {
  await result.current.asyncOperation();
});

// Wait for effects to complete
await waitFor(() => {
  expect(screen.getByText("Updated")).toBeInTheDocument();
});
```

### Testing Custom Hooks

```typescript
const { result } = renderHook(() => useTagData());

// Access hook return values
expect(result.current.smartPlaylists).toHaveLength(0);

// Test hook actions
act(() => {
  result.current.storeSmartPlaylist(mockPlaylist);
});
```

### Testing Error Boundaries

```typescript
// Test component error handling
const ThrowError = () => {
  throw new Error("Test error");
};

render(
  <ErrorBoundary>
    <ThrowError />
  </ErrorBoundary>
);

expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
```

## Troubleshooting

### Common Issues

1. **Tests timing out**

   - Check for unresolved promises
   - Ensure mocks are properly configured
   - Use proper async/await patterns

2. **Memory leaks in tests**

   - Clear mocks in beforeEach
   - Clean up event listeners
   - Reset global state

3. **Flaky tests**

   - Add proper waitFor conditions
   - Avoid relying on timing
   - Use deterministic test data

4. **Mock not working**
   - Verify mock is imported before the module under test
   - Check mock implementation
   - Ensure vi.clearAllMocks() is called

### Getting Help

- Check Vitest documentation: https://vitest.dev/
- Review Testing Library guides: https://testing-library.com/
- Examine existing test patterns in the codebase

## Extending Tests

### Adding New Test Cases

1. Identify the functionality to test
2. Choose appropriate test category (unit/integration/etc.)
3. Use existing helpers and patterns
4. Follow naming conventions
5. Add to relevant test suite

### Adding New Mock Data

1. Add factory function to `test-helpers.ts`
2. Follow existing patterns
3. Make it configurable with overrides
4. Document the new helper

### Performance Benchmarks

1. Add to `performance/` directory
2. Set reasonable thresholds
3. Test both happy path and edge cases
4. Monitor results over time
