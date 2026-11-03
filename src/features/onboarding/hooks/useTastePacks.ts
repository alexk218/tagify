import { useCallback, useEffect, useMemo, useState } from "react";
import type { TagTaxonomy } from "@/types/tagData";
import { tastePackChoices } from "@/utils/tastePackTaxonomy";
import { recordProductInteraction, recordTastePacksAdded } from "@/features/product-analytics/productAnalytics";
import { addTastePacks } from "../services/tastePacks";
import { isTastePackStepOffered, markTastePacksAnswered, shouldOfferTastePacks } from "../services/tastePackStep";

interface UseTastePacksOptions {
  taxonomy: TagTaxonomy;
  isLoading: boolean;
  taggedTrackCount: number;
  /** Community is offering to restore a backup into this library. */
  restoreOnOffer: boolean;
  /** Shows the saved tags once the packs are in. */
  showSavedTags: () => Promise<void>;
}

/** "What do you listen to?" on a fresh install: whether to show it, its packs, and its answers. */
export function useTastePacks({ taxonomy, isLoading, taggedTrackCount, restoreOnOffer, showSavedTags }: UseTastePacksOptions) {
  const [offered, setOffered] = useState(isTastePackStepOffered);
  // The install that marks the step can finish while the page is still loading.
  useEffect(() => { if (!isLoading) setOffered(isTastePackStepOffered()); }, [isLoading]);

  const showTastePacks = shouldOfferTastePacks({ offered, isLoading, taggedTrackCount, restoreOnOffer, taxonomy });
  const choices = useMemo(() => (showTastePacks ? tastePackChoices(taxonomy) : []), [showTastePacks, taxonomy]);

  const add = useCallback(async (keys: string[]) => {
    const results = await addTastePacks(keys);
    // addTastePacks throws unless saveTaxonomy saved them, so this counts only packs that are in.
    recordTastePacksAdded(results.map((result) => result.key), "first_run");
    markTastePacksAnswered("added");
    setOffered(false);
    await showSavedTags().catch((error) => console.error("Tagify: Could not show the added tags yet", error));
    return results;
  }, [showSavedTags]);

  const skip = useCallback(() => {
    recordProductInteraction("taste_packs_skipped");
    markTastePacksAnswered("skipped");
    setOffered(false);
  }, []);

  return { showTastePacks, tastePackChoices: choices, addTastePacks: add, skipTastePacks: skip };
}
