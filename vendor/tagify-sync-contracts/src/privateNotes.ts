export const MAX_PRIVATE_NOTE_LENGTH = 5000;
export const MAX_PRIVATE_NOTE_BATCH = 50;
export interface PrivateNoteV1 { uri: string; text: string; revision: number; updatedAt: string }
export interface PrivateNoteEditV1 { uri: string; text: string; expectedRevision: number }
export interface PrivateNotePageV1 { notes: PrivateNoteV1[]; nextCursor: number; hasMore: boolean }
export interface PrivateNoteWriteResultV1 { saved: PrivateNoteV1[]; conflicts: PrivateNoteV1[] }
export function isPrivateNoteUri(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value) &&
    (/^spotify:(track|album|artist|playlist):[A-Za-z0-9]{10,64}$/.test(value) || /^spotify:local:.+/.test(value));
}
const revision = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
export function assertPrivateNoteEdits(value: unknown): asserts value is PrivateNoteEditV1[] {
  if (!Array.isArray(value) || !value.length || value.length > MAX_PRIVATE_NOTE_BATCH) throw new Error("Invalid note changes");
  const seen = new Set<string>();
  for (const note of value) {
    if (!record(note) || !isPrivateNoteUri(note.uri) || typeof note.text !== "string" || note.text.length > MAX_PRIVATE_NOTE_LENGTH || !revision(note.expectedRevision) || seen.has(note.uri)) throw new Error("Invalid note changes");
    seen.add(note.uri);
  }
}
export function assertPrivateNote(value: unknown): asserts value is PrivateNoteV1 {
  if (!record(value) || !isPrivateNoteUri(value.uri) || typeof value.text !== "string" || value.text.length > MAX_PRIVATE_NOTE_LENGTH || !revision(value.revision) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error("Invalid note backup");
}
export function assertPrivateNotePage(value: unknown): asserts value is PrivateNotePageV1 {
  if (!record(value) || !Array.isArray(value.notes) || value.notes.length > MAX_PRIVATE_NOTE_BATCH || !revision(value.nextCursor) || typeof value.hasMore !== "boolean") throw new Error("Invalid note backup page");
  const seen = new Set<string>();
  for (const note of value.notes) { assertPrivateNote(note); if (seen.has(note.uri) || note.revision > value.nextCursor) throw new Error("Invalid note backup page"); seen.add(note.uri); }
}
export function assertPrivateNoteWriteResult(value: unknown): asserts value is PrivateNoteWriteResultV1 {
  if (!record(value) || !Array.isArray(value.saved) || !Array.isArray(value.conflicts) || value.saved.length + value.conflicts.length > MAX_PRIVATE_NOTE_BATCH) throw new Error("Invalid note save result");
  const seen = new Set<string>();
  for (const note of [...value.saved, ...value.conflicts]) { assertPrivateNote(note); if (seen.has(note.uri)) throw new Error("Invalid note save result"); seen.add(note.uri); }
}
