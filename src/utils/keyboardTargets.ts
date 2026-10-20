// Keys typed into a field, or pressed while focus is inside a dialog or popover (Invite a friend,
// Tagify's and Spotify's modals), belong to that control rather than to Tagify's page-wide
// shortcuts. Native <dialog> elements have no role attribute, so they are matched by tag.
const TYPING_OR_DIALOG_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  "dialog",
].join(", ");

/** Whether a key event from `target` should be left to the field or dialog it came from. */
export function isTypingOrDialogTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  return target.closest(TYPING_OR_DIALOG_SELECTOR) !== null;
}
