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
  // Default values
  let title = "Local Track";
  let artist = "Local Artist";
  let album = "Local File";

  try {
    if (!uri.startsWith("spotify:local:")) {
      throw new Error("Not a local file URI");
    }

    // Split the URI into parts
    const parts = uri.split(":");

    // Handle different known formats
    if (parts.length >= 5) {
      // Try to determine which format we're dealing with

      // Format: spotify:local:artist:album:title:duration
      // or more commonly: spotify:local:::artist:title

      // Check if we have the first format with all parts
      if (parts.length >= 6 && parts[2] && parts[3] && parts[4]) {
        // This is likely the full format with artist, album, title
        artist = decodeURIComponent(parts[2].replace(/\+/g, " "));
        album = decodeURIComponent(parts[3].replace(/\+/g, " "));
        title = decodeURIComponent(parts[4].replace(/\+/g, " "));

        // Clean up format
        title = title.replace(/\.[^/.]+$/, ""); // Remove file extension
      }
      // More common format: spotify:local:::artist:title
      else if (parts[2] === "" && parts[3] === "") {
        // Format with empty artist/album slots but has artist:title at the end
        const potentialArtist = decodeURIComponent(parts[4].replace(/\+/g, " "));
        const potentialTitle = decodeURIComponent(parts[5].replace(/\+/g, " "));

        // Check if last part is just a number (duration)
        if (!isNaN(Number(potentialTitle))) {
          // If the "title" is just a number, it's probably the duration
          // In this case, use the artist field as the combined title
          title = potentialArtist;
          artist = "Local Artist";
        } else {
          // Otherwise use the two fields as intended
          artist = potentialArtist;
          title = potentialTitle.replace(/\.[^/.]+$/, ""); // Remove file extension
        }
      }
      // Handle any other patterns we might encounter
      else {
        // Try to get the last two parts as artist and title
        const secondLast = parts[parts.length - 2];
        const last = parts[parts.length - 1];

        if (secondLast && last) {
          artist = decodeURIComponent(secondLast.replace(/\+/g, " "));
          title = decodeURIComponent(last.replace(/\+/g, " "));

          // Clean up
          title = title.replace(/\.[^/.]+$/, ""); // Remove file extension

          // If title is just a number, it's likely the duration
          if (!isNaN(Number(title))) {
            title = artist;
            artist = "Local Artist";
          }
        }
      }
    }

    // Additional cleanup
    title = title.trim();
    artist = artist.trim();

    // Fall back to defaults if we ended up with empty strings
    if (!title) title = "Local Track";
    if (!artist) artist = "Local Artist";

    // For display in the UI, if the title seems to contain the full information
    // (like "Artist - Title" format), keep it as is
    if (title.includes(" - ") && artist === "Local Artist") {
      // Already has artist-title format, keep it
    }
    // If we couldn't extract a meaningful title (e.g., it's a number or very short)
    else if (title.length < 3 || !isNaN(Number(title))) {
      // Use a combination of available information
      const parts = uri.split(":").filter((p) => p && p !== "spotify" && p !== "local");
      if (parts.length > 0) {
        const combined = parts.map((p) => decodeURIComponent(p.replace(/\+/g, " "))).join(" - ");
        title = combined || "Local Track";
        artist = "Local File";
      }
    }
  } catch (error) {
    console.error("Error parsing local file URI:", error);
    // Use defaults on error
    title = "Local Track";
    artist = "Local Artist";
  }

  return {
    title,
    artist,
    album,
    isLocalFile: true,
  };
}
