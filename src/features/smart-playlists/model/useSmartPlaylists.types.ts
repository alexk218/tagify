import type { MutableRefObject } from "react";
import type { TagDataStructure } from "@/types/tagData";

export interface SyncOperation {
  id: string;
  type: "single" | "multiple";
  execute: () => Promise<void>;
}

export interface UseSmartPlaylistProps {
  tagDataRef: MutableRefObject<TagDataStructure>;
}
