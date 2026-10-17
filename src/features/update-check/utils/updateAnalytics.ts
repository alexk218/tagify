import { recordProductInteraction, type ProductEventDetails } from "@/features/product-analytics/productAnalytics";

type UpdateKind = NonNullable<ProductEventDetails["update_kind"]>;
type DownloadMethod = NonNullable<ProductEventDetails["method"]>;

const SHOWN_PREFIX = "tagify:update-banner-shown:";
const numbers = (version: string) => (version.replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number);

/** How big the waiting update is. Unparseable versions count as a patch so the event still reports. */
export function updateKind(current: string, latest: string): UpdateKind {
  const [currentMajor, currentMinor] = numbers(current);
  const [latestMajor, latestMinor] = numbers(latest);
  if (latestMajor !== undefined && latestMajor !== currentMajor) return "major";
  if (latestMinor !== undefined && latestMinor !== currentMinor) return "minor";
  return "patch";
}

/** The banner reappears on every Tagify open, so it is reported at most once a day for each waiting version. */
export function recordUpdateBannerShown(current: string, latest: string, now = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  try {
    if (localStorage.getItem(SHOWN_PREFIX + latest) === day) return;
    localStorage.setItem(SHOWN_PREFIX + latest, day);
  } catch { /* Reporting without the reminder only risks a repeat count. */ }
  recordProductInteraction("update_banner_shown", { update_kind: updateKind(current, latest) });
}

export const recordUpdateInstructionsOpened = () => recordProductInteraction("update_instructions_opened");
export const recordUpdateDownload = (method: DownloadMethod) => recordProductInteraction("update_download_clicked", { method });
export const recordUpdateBannerDismissed = () => recordProductInteraction("update_banner_dismissed");
