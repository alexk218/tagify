import type { TagTaxonomy } from "@/types/tagData";
import { hasCustomTaxonomy } from "@/features/tag-data/utils/tagData.schema";

// "What do you listen to?" is offered once, on a fresh install: the install that saved Tagify's
// starter tags into an empty library marks it "offered", and adding packs or skipping answers it.
// Libraries that existed before this version never get the mark, so they never see the step.
const TASTE_PACKS_KEY = "tagify:taste-packs:v1";
type TastePackStepState = "offered" | "added" | "skipped";

function read(): TastePackStepState | null {
  try {
    const value = localStorage.getItem(TASTE_PACKS_KEY);
    return value === "offered" || value === "added" || value === "skipped" ? value : null;
  } catch { return null; }
}

function write(state: TastePackStepState): void {
  try { localStorage.setItem(TASTE_PACKS_KEY, state); } catch { /* The step may then be offered again next time. */ }
}

/** Called when a fresh install has just saved the starter tags into an empty library. */
export const markTastePacksOffered = () => { if (read() === null) write("offered"); };
export const markTastePacksAnswered = (result: "added" | "skipped") => write(result);
export const isTastePackStepOffered = () => read() === "offered";

interface TastePackStepConditions {
  /** The fresh-install mark is there and the step hasn't been answered. */
  offered: boolean;
  isLoading: boolean;
  taggedTrackCount: number;
  /** Community is offering to restore a backup into this library. */
  restoreOnOffer: boolean;
  taxonomy: TagTaxonomy;
}

/**
 * Who sees the step: a fresh install that hasn't answered it, with nothing tagged, still holding
 * only the starter tags (taste packs as they were added don't count), and no backup restore on
 * offer, since restoring brings back the person's own tags.
 */
export function shouldOfferTastePacks({ offered, isLoading, taggedTrackCount, restoreOnOffer, taxonomy }: TastePackStepConditions): boolean {
  return offered && !isLoading && taggedTrackCount === 0 && !restoreOnOffer && !hasCustomTaxonomy(taxonomy);
}
