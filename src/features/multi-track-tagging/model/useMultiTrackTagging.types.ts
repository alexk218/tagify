import { TagDataStructure, TrackTag } from "@/types/tagData";

export interface DraftTrackTagData {
  tagIds: TrackTag[];
  rating: number;
  energy: number;
}

export type DraftTagState = Record<string, DraftTrackTagData>;

export interface UseMultiTrackTaggingOptions {
  tagData: TagDataStructure;
}
