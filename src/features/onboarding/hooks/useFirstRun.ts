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
  // Adding members' tags keeps the card open for more songs until the payoff can show.
  const [addingMembersTags, setAddingMembersTags] = useState(false);
  // Tag data is empty until it loads, so only a loaded library can count as having nothing tagged.
  const showFirstSongCard = !isLoading && !firstSongPicked && !isMultiTagging &&
    (taggedTrackCount === 0 || (addingMembersTags && taggedTrackCount < PAYOFF_MIN_TAGGED));
  const [inProgress, setInProgress] = useState(isFirstRunInProgress);

  const startFirstRun = useCallback(() => {
    setFirstSongPicked(true);
    markFirstRunStarted();
    setInProgress(isFirstRunInProgress());
  }, []);
  const startWithMembersTags = useCallback(() => {
    setAddingMembersTags(true);
    markFirstRunStarted();
    setInProgress(isFirstRunInProgress());
  }, []);
  const finishFirstRun = useCallback(() => {
    markFirstRunDone();
    setInProgress(false);
  }, []);

  const payoffTag = useMemo(
    () => inProgress && !isLoading && taggedTrackCount >= PAYOFF_MIN_TAGGED ? mostUsedTag(tagData) : null,
    [inProgress, isLoading, taggedTrackCount, tagData],
  );

  return { showFirstSongCard, payoffTag, startFirstRun, startWithMembersTags, finishFirstRun };
}
