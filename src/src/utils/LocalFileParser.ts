/**
 * Utility function to parse local file URIs and extract usable metadata
 */

// Define a type for the parsed result
interface ParsedLocalFile {
  title: string;
  artist: string;
  album: string;
  isLocalFile: true;
}

/**
 * Parse a Spotify local file URI and extract useful metadata
 * Handles different URI formats and edge cases
 */
export function parseLocalFileUri(uri: string): ParsedLocalFile {
  let title = "Local Track";
  let artist = "Local Artist";
  let album = "Local File";

  try {
    if (!uri.startsWith("spotify:local:")) {
      throw new Error("Not a local file URI");
    }

    const parts = uri.split(":");

    if (parts.length >= 5) {
      // Format: spotify:local:artist:album:title:duration
      if (parts[2] && parts[3] && parts[4]) {
        artist = decodeURIComponent(parts[2].replace(/\+/g, " "));
        album = decodeURIComponent(parts[3].replace(/\+/g, " "));
        title = decodeURIComponent(parts[4].replace(/\+/g, " "));
      }
      // Format: spotify:local:::combined_info:duration
      else if (parts[2] === "" && parts[3] === "" && parts[4]) {
        const combinedInfo = decodeURIComponent(parts[4].replace(/\+/g, " "));

        // Try to parse "Artist - Title" or "Artist + Title" patterns
        if (combinedInfo.includes(" - ")) {
          const splitInfo = combinedInfo.split(" - ");
          if (splitInfo.length >= 2) {
            artist = splitInfo[0].trim();
            title = splitInfo.slice(1).join(" - ").trim();
          } else {
            title = combinedInfo;
          }
        }
        // Handle "+" as separator (like "Artist + Artist + Title")
        else if (combinedInfo.includes(" + ") && !combinedInfo.match(/\+\+/)) {
          const plusParts = combinedInfo.split(" + ");
          if (plusParts.length >= 2) {
            // Last part is likely the title, everything before is artist(s)
            title = plusParts[plusParts.length - 1].trim();
            artist = plusParts.slice(0, -1).join(" + ").trim();
          } else {
            title = combinedInfo;
          }
        } else {
          // No clear separator, use as title
          title = combinedInfo;
        }
      }
      // Format: spotify:local:artist::title:duration
      else if (parts[2] && parts[3] === "" && parts[4]) {
        artist = decodeURIComponent(parts[2].replace(/\+/g, " "));
        title = decodeURIComponent(parts[4].replace(/\+/g, " "));
      }
    }

    // Clean up
    title = title.replace(/\.[^/.]+$/, "").trim();
    artist = artist.trim();
    album = album.trim();

    // Final fallbacks
    if (!title) title = "Local Track";
    if (!artist) artist = "Local Artist";
    if (!album) album = "Local File";
  } catch (error) {
    console.error("Error parsing local file URI:", error);
  }

  return {
    title,
    artist,
    album,
    isLocalFile: true,
  };
}
