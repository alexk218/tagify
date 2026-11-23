import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TagTaxonomy } from "@/types/tagData";
import { tastePackChoices } from "@/utils/tastePackTaxonomy";
import { buildMoodsStarterTaxonomy } from "@/constants/defaultTagData";
import { recordProductInteraction, recordTastePacksAdded } from "@/features/product-analytics/productAnalytics";
import {
  isTasteQuestionOffered,
  markTasteQuestionAnswered,
  saveTasteQuestionAnswer,
  shouldAskTasteQuestion,
} from "../services/tasteQuestion";

interface UseTasteQuestionOptions {
  taxonomy: TagTaxonomy;
  isLoading: boolean;
  taggedTrackCount: number;
  connected: boolean;
  /** Community is offering to restore a backup into this library. */
  restoreOnOffer: boolean;
  /** Shows the saved tags once the answer is in. */
  showSavedTags: () => Promise<void>;
}

/** "What do you listen to?" for a new desktop library: whether to ask, the packs, and the two answers. */
export function useTasteQuestion({ taxonomy, isLoading, taggedTrackCount, connected, restoreOnOffer, showSavedTags }: UseTasteQuestionOptions) {
  const [offered, setOffered] = useState(isTasteQuestionOffered);
  // The install that marks the question can finish while the page is still loading.
  useEffect(() => { if (!isLoading) setOffered(isTasteQuestionOffered()); }, [isLoading]);

  const asking = shouldAskTasteQuestion({ offered, isLoading, taggedTrackCount, connected, restoreOnOffer, taxonomy });
  // Packs are offered against Moods and moments, the tags the answer starts from.
  const choices = useMemo(() => (asking ? tastePackChoices(buildMoodsStarterTaxonomy()) : []), [asking]);

  const shownOnce = useRef(false);
  useEffect(() => {
    if (!asking || shownOnce.current) return;
    shownOnce.current = true;
    recordProductInteraction("taste_packs_shown");
  }, [asking]);

  const finish = useCallback(async (result: "added" | "skipped") => {
    markTasteQuestionAnswered(result);
    setOffered(false);
    await showSavedTags().catch((error) => console.error("Tagify: Could not show the new tags yet", error));
  }, [showSavedTags]);

  const answer = useCallback(async (keys: string[]) => {
    const packs = await saveTasteQuestionAnswer(keys);
    // saveTasteQuestionAnswer throws unless the tags were saved, so this counts only packs that are in.
    if (keys.length) recordTastePacksAdded(packs.map((pack) => pack.key), "first_run");
    else recordProductInteraction("taste_packs_skipped");
    await finish(keys.length ? "added" : "skipped");
  }, [finish]);

  return { asking, choices, answer };
}
