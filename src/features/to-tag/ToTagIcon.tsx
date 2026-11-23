import React from "react";
import { TAGIFY_LOGO_PATH, TO_TAG_CHECK_PATH, TO_TAG_PLUS_PATH } from "./toTagIcons";

/** The Tagify logo with a plus (add to To Tag) or a check (on the list). */
export function ToTagIcon({ onList, size = 16 }: { onList: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path transform="scale(0.75)" d={TAGIFY_LOGO_PATH} />
      <path d={onList ? TO_TAG_CHECK_PATH : TO_TAG_PLUS_PATH} />
    </svg>
  );
}
