const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"], .GenericModal, .tagify-portal > *';

type VisibilityCheck = (options?: { visibilityProperty?: boolean }) => boolean;

// Spotify keeps some dialogs, such as its language and country pickers, mounted but hidden.
// Only dialogs actually on screen should hold back Tagify's own prompts.
function isShown(element: Element): boolean {
  const checkVisibility = (element as Element & { checkVisibility?: VisibilityCheck }).checkVisibility;
  return typeof checkVisibility === "function" ? checkVisibility.call(element, { visibilityProperty: true }) : true;
}

/** Whether a dialog other than `own` (and anything containing it) is currently shown. */
export function isAnotherDialogOpen(own?: Element | null): boolean {
  return Array.from(document.querySelectorAll(DIALOG_SELECTOR)).some((node) =>
    (!own || (!node.contains(own) && !own.contains(node))) && isShown(node));
}
