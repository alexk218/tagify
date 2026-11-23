import {
  spotifyNowPlayingShare,
  spotifyShareSheetTagify,
  tagInTagifySheet,
} from "@/assets/spotifyPhoneTaggingScreenshots";

/** The three iPhone steps for tagging a Spotify song, shared by the one-time popup and the Tagify Guide. */
export const PHONE_TAGGING_STEPS = [
  { image: spotifyNowPlayingShare, caption: "Tap Share in Spotify", alt: "Spotify's Now Playing screen on iPhone, with the Share button marked" },
  { image: spotifyShareSheetTagify, caption: "Pick Tagify", alt: "The iPhone share sheet from Spotify, with Tagify marked" },
  { image: tagInTagifySheet, caption: "Rate it, tag it, Done", alt: "Tagify's Tag in Tagify sheet with stars, tags and a Done button" },
] as const;
