import type { PrivateNoteV1 } from "@tagify/sync-contracts";
export interface LocalPrivateNote extends PrivateNoteV1 {
  dirty: boolean;
  baseText: string;
  conflict?: PrivateNoteV1;
}
export type PrivateNotesBackup = Record<string, { text: string; conflictText?: string }>;
export const PRIVATE_NOTES_CHANGED_EVENT = "tagify:privateNotesChanged";
