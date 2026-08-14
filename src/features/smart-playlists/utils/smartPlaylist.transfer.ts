import { SmartPlaylistCriteria } from "@/features/smart-playlists/model/smartPlaylist.types";

export function downloadSmartPlaylistsBackup(
  playlists: SmartPlaylistCriteria[],
): void {
  const jsonData = JSON.stringify(playlists, null, 2);
  const blob = new Blob([jsonData], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `tagify-smart-playlists-${new Date().toISOString().split("T")[0]}.json`;
  anchor.click();

  URL.revokeObjectURL(url);
}
