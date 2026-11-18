import { useCallback, useMemo, useState } from "react";
import type { TagDataStructure } from "@/types/tagData";
import { isFirstRunInProgress, markFirstRunDone, markFirstRunStarted, mostUsedTag, PAYOFF_MIN_TAGGED } from "../services/firstRun";

interface UseFirstRunOptions {
  tagData: Pick<TagDataStructure, "tracks" | "taxonomy">;
  isLoading: boolean;
  isMultiTagging: boolean;
}

/** "Tag your first song" for a library with nothing tagged, then the payoff for people who picked a song there. */
export function useFirstRun({ tagData, isLoading, isMultiTagging }: UseFirstRunOptions) {
  const taggedTrackCount = Object.keys(tagData.tracks).length;
  const [firstSongPicked, setFirstSongPicked] = useState(false);
  // Tagging on the card (one-click tags or members' tags) keeps it open until the payoff can show.
  const [taggingOnCard, setTaggingOnCard] = useState(false);
  // Tag data is empty until it loads, so only a loaded library can count as having nothing tagged.
  const showFirstSongCard = !isLoading && !firstSongPicked && !isMultiTagging &&
    (taggedTrackCount === 0 || (taggingOnCard && taggedTrackCount < PAYOFF_MIN_TAGGED));
  const [inProgress, setInProgress] = useState(isFirstRunInProgress);

  const startFirstRun = useCallback(() => {
    setFirstSongPicked(true);
    markFirstRunStarted();
    setInProgress(isFirstRunInProgress());
  }, []);
  const startTaggingOnCard = useCallback(() => {
    setTaggingOnCard(true);
    markFirstRunStarted();
    setInProgress(isFirstRunInProgress());
  }, []);
  // Tags added from Community's "Your songs, tagged by others": only a library still on "Tag your
  // first song" starts a first run there; a library that is past it never gets the payoff from that list.
  const startFromCommunityList = useCallback(() => {
    if (showFirstSongCard) startTaggingOnCard();
  }, [showFirstSongCard, startTaggingOnCard]);
  const finishFirstRun = useCallback(() => {
    markFirstRunDone();
    setInProgress(false);
  }, []);

  const payoffTag = useMemo(
    () => inProgress && !isLoading && taggedTrackCount >= PAYOFF_MIN_TAGGED ? mostUsedTag(tagData) : null,
    [inProgress, isLoading, taggedTrackCount, tagData],
  );

  return { showFirstSongCard, payoffTag, startFirstRun, startTaggingOnCard, startFromCommunityList, finishFirstRun };
}
