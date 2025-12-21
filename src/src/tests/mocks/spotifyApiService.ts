import { vi } from "vitest";

export const mockSpotifyApiService = {
  getCurrentUser: vi.fn(),
  getPlaylistMetadata: vi.fn(),
  getAudioFeatures: vi.fn(),
  createPlaylist: vi.fn(),
  addTracksToPlaylist: vi.fn(),
  addTrackToPlaylist: vi.fn(),
  removeTrackFromPlaylist: vi.fn(),
  getAllUserPlaylistIds: vi.fn(),
  getAllTrackUrisInPlaylist: vi.fn(),
  isTrackInPlaylist: vi.fn(),
  fetchBpm: vi.fn(),
  extractTrackId: vi.fn(),
};
