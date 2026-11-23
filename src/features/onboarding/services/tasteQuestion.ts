import type { TastePackInstallResult } from "@tagify/community-contracts";
import type { TagTaxonomy } from "@/types/tagData";
import { buildMoodsStarterTaxonomy } from "@/constants/defaultTagData";
import { hasCustomTaxonomy } from "@/features/tag-data/utils/tagData.schema";
import { dispatchTagDataUpdatedEvent } from "@/features/tag-data/utils/tagData.events";
import { indexedDBStorage } from "@/services/storage/IndexedDBStorageService";
import { flushLocalPersistence, getTagifyDatabaseName } from "@/services/sync/SyncLocalState";
import { planTastePacksForTaxonomy } from "@/utils/tastePackTaxonomy";

/**
 * "What do you listen to?" for people who start on Tagify desktop: the same question new members
 * get on the Community website and on iPhone (Community PR #1754). Alex, 2026-11-23: "What if we add
 * the same "what do you listen to" introduction for users that start on Tagify Desktop? ... it would
 * have to work well with the existing tooltip onboarding". His website answers apply here too:
 * "A · Tick music types", "A · Moods and moments", "A · Skip, like iPhone".
 *
 * - Asked once, only of a new library: the install that saves the starter tags into an empty
 *   library marks it "offered" (StorageMigrationService). Libraries from before never get the mark.
 * - Continue and Skip both answer it. Each leaves the library with Moods and moments (Mood & Energy
 *   and Usage & Context of the starter tags), plus the packs ticked for Continue.
 * - The first-run tips wait until it's answered, then start straight away.
 */
const TASTE_QUESTION_KEY = "tagify:taste-question:v1";
type TasteQuestionState = "offered" | "added" | "skipped";

function read(): TasteQuestionState | null {
  try {
    const value = localStorage.getItem(TASTE_QUESTION_KEY);
    return value === "offered" || value === "added" || value === "skipped" ? value : null;
  } catch { return null; }
}

function write(state: TasteQuestionState): void {
  try { localStorage.setItem(TASTE_QUESTION_KEY, state); } catch { /* It may then be asked again next time. */ }
}

/** Called when a fresh install has just saved the starter tags into an empty library. */
export const markTasteQuestionOffered = () => { if (read() === null) write("offered"); };
export const markTasteQuestionAnswered = (result: "added" | "skipped") => write(result);
export const isTasteQuestionOffered = () => read() === "offered";

export interface TasteQuestionConditions {
  /** The fresh-install mark is there and the question hasn't been answered. */
  offered: boolean;
  /** The switch is on (a look is chosen). */
  isLoading: boolean;
  taggedTrackCount: number;
  /** Connected to Community: the account's own tags (or the website's question) decide them. */
  connected: boolean;
  /** Community is offering to restore a backup into this library. */
  restoreOnOffer: boolean;
  taxonomy: TagTaxonomy;
}

/**
 * Who is asked: a new library that hasn't answered, with nothing tagged, still holding only the
 * starter tags, not connected to Community and with no restore on offer. Anything the person made
 * themselves means it's no longer a new library, so it's never asked and nothing is replaced.
 */
export function shouldAskTasteQuestion({ offered, isLoading, taggedTrackCount, connected, restoreOnOffer, taxonomy }: TasteQuestionConditions): boolean {
  return offered && !isLoading && taggedTrackCount === 0 && !connected && !restoreOnOffer && !hasCustomTaxonomy(taxonomy);
}

/**
 * The library after an answer: Moods and moments plus the ticked packs. The starter tags are only
 * swapped for Moods and moments while they're still untouched and nothing is tagged (so no song
 * loses a tag and no `dateModified` changes); otherwise the packs are added to the tags as they are.
 */
export function tasteQuestionTaxonomy(current: TagTaxonomy, keys: readonly string[], untouched: boolean): { taxonomy: TagTaxonomy; packs: TastePackInstallResult[] } {
  const base = untouched ? buildMoodsStarterTaxonomy() : current;
  if (keys.length === 0) return { taxonomy: base, packs: [] };
  const { plan, taxonomy } = planTastePacksForTaxonomy(base, keys);
  return { taxonomy, packs: plan.packs };
}

/**
 * Saves the answer through saveTaxonomy, like any edit to the tags. Re-checks inside the save that
 * the library is still new (no tagged songs, starter tags untouched), so an edit made meanwhile in
 * another window is never replaced. Returns what each pack added.
 */
export async function saveTasteQuestionAnswer(keys: readonly string[], expectedDatabaseName = getTagifyDatabaseName()): Promise<TastePackInstallResult[]> {
  await flushLocalPersistence();
  const untouched = (await indexedDBStorage.getTrackCount()) === 0;
  let packs: TastePackInstallResult[] | null = null;
  const saved = await indexedDBStorage.saveTaxonomy((current) => {
    if (expectedDatabaseName !== getTagifyDatabaseName()) throw new Error("Your account changed. Open Tagify again to set up your tags.");
    const result = tasteQuestionTaxonomy(current, keys, untouched && !hasCustomTaxonomy(current));
    packs = result.packs;
    return result.taxonomy;
  });
  if (!saved || !packs) throw new Error("Your tags couldn't be set up. Try again in a moment.");
  // The extension shows the new tags in Spotify's menus too.
  dispatchTagDataUpdatedEvent("save");
  return packs;
}
