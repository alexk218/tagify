# Components Documentation

## Component Overview

| Component                                    | Purpose                      | Source                                             | Key Props                          |
| -------------------------------------------- | ---------------------------- | -------------------------------------------------- | ---------------------------------- |
| [TrackDetails](./TrackDetails.tsx)           | Track info display & tagging | [`TrackDetails.tsx`](./TrackDetails.tsx)           | `track`, `trackData`, `categories` |
| [TagSelector](./TagSelector.tsx)             | Tag selection interface      | [`TagSelector.tsx`](./TagSelector.tsx)             | `categories`, `onToggleTag`        |
| [TrackList](./TrackList.tsx)                 | Filtered track listing       | [`TrackList.tsx`](./TrackList.tsx)                 | `tracks`, `filters`                |
| [MultiTrackDetails](./MultiTrackDetails.tsx) | Multi-track operations       | [`MultiTrackDetails.tsx`](./MultiTrackDetails.tsx) | `multiTagTracks`                   |

## TrackDetails Component

**Location**: [`./TrackDetails.tsx`](./TrackDetails.tsx)  
**Purpose**: Primary track information display and tagging interface

### Key Features

- Track metadata display (title, artist, album)
- Rating system (1-5 stars)
- Energy level slider (1-10)
- BPM detection and manual input
- Tag display and management
- Lock mechanism for focused tagging
- Navigation to artist/album pages

### Props Interface

See detailed JSDoc comments in [`TrackDetails.tsx`](./TrackDetails.tsx#L15-L45) for complete prop definitions.

### Usage Examples

```tsx
// Basic usage
<TrackDetails
  track={activeTrack}
  trackData={getTrackData(activeTrack.uri)}
  categories={categories}
  onSetRating={setRating}
  onSetEnergy={setEnergy}
  onSetBpm={setBpm}
  onRemoveTag={toggleTag}
  activeTagFilters={activeFilters}
  excludedTagFilters={excludedFilters}
  onFilterByTag={filterByTag}
  onUpdateBpm={updateBpm}
/>
```

### State Dependencies

- `useTrackState` → `activeTrack`, `isLocked`, `toggleLock`
- `useTagData` → `categories`, `trackData`, tag operations
- `useFilterState` → filter arrays and handlers

For implementation details, see JSDoc comments in the [source file](./TrackDetails.tsx).

## Quick Reference

### Adding New Components

1. Create component file with JSDoc comments
2. Add entry to the table above
3. Link to source file using `./ComponentName.tsx`
4. Document key props and usage patterns

### Documentation Standards

- Use JSDoc comments for prop interfaces
- Include usage examples in component files
- Link between markdown docs and source using relative paths
- Keep this README as a high-level overview
