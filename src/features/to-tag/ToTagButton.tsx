import React, { useState } from "react";
import styles from "./ToTagButton.module.css";
import { ToTagIcon } from "./ToTagIcon";
import { addToTag, removeFromToTag, useToTagList, type ToTagSongDetails } from "./toTagStore";

interface ToTagButtonProps {
  uri: string;
  details: ToTagSongDetails;
}

/**
 * Track Details control: put the song on the To Tag list, or tick it off once it's done. Always the
 * icon alone (Alex, 2026-11-23: "never have the to tag text here, just the icon"); the icon's check
 * shows the song is on the list.
 */
export function ToTagButton({ uri, details }: ToTagButtonProps) {
  const onList = useToTagList().some((entry) => entry.uri === uri);
  const [error, setError] = useState<string | null>(null);
  if (!uri.startsWith("spotify:track:") && !uri.startsWith("spotify:local:")) return null;

  const toggle = () => {
    setError(null);
    try {
      if (onList) removeFromToTag([uri]);
      else addToTag([{ uri, ...details }]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Couldn’t update your To Tag list. Please try again.");
    }
  };

  const title = error ?? (onList
    ? "On your To Tag list. Click when you’re done to tick it off."
    : "Add to your To Tag list to come back to it later");
  return (
    <button
      type="button"
      className={`${styles.button} ${onList ? styles.onList : ""}`}
      onClick={toggle}
      title={title}
      aria-label={onList ? "Done: remove from To Tag" : "Add to To Tag"}
      aria-pressed={onList}
    >
      <ToTagIcon onList={onList} size={14} />
    </button>
  );
}
