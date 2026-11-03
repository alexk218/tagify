import React, { useState } from "react";
import { Check } from "lucide-react";
import type { TastePackInstallResult } from "@tagify/community-contracts";
import type { TastePackChoice } from "@/utils/tastePackTaxonomy";
import styles from "./TastePacksPicker.module.css";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** What Spotify's notification says once packs are in the library. Pack names have commas, so three or more are counted. */
export function tastePacksAddedMessage(choices: readonly TastePackChoice[], results: readonly TastePackInstallResult[]): string {
  const added = results.filter((result) => result.added.length > 0);
  if (added.length === 0) return "You already have these tags.";
  const names = added.map((result) => choices.find((choice) => choice.key === result.key)?.name ?? result.key);
  const tags = added.reduce((total, result) => total + result.added.length, 0);
  const packs = names.length <= 2 ? names.join(" and ") : plural(names.length, "pack");
  return `Added ${plural(tags, "tag")} for ${packs} to Genre & Style.`;
}

export interface TastePacksPickerProps {
  choices: readonly TastePackChoice[];
  onAdd: (keys: string[]) => Promise<TastePackInstallResult[]>;
  /** Without it there's no Skip button. */
  onSkip?: () => void;
  /** The Skip button's words. */
  skipLabel?: string;
  /**
   * Where the "Added …" message goes instead of Spotify's notification. With it the picker stays
   * usable after adding (Tag Manager), and packs already in the tags show as added.
   */
  onAdded?: (message: string) => void;
}

/** "What do you listen to?": packs of tags for kinds of music, any number of them, or Skip. */
export function TastePacksPicker({ choices, onAdd, onSkip, skipLabel = "Skip", onAdded }: TastePacksPickerProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const toggle = (key: string) => setChosen((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const add = async () => {
    setProblem("");
    setBusy(true);
    try {
      const keys = choices.filter((choice) => chosen.has(choice.key)).map((choice) => choice.key);
      const results = await onAdd(keys);
      const message = tastePacksAddedMessage(choices, results);
      if (onAdded) {
        onAdded(message);
        setChosen(new Set());
        setBusy(false);
      } else {
        Spicetify.showNotification(message);
      }
    } catch (error) {
      console.error("Tagify: Taste packs could not be added", error);
      setProblem("Your tags couldn't be added. Try again in a moment.");
      setBusy(false);
    }
  };

  return (
    <div className={styles.picker}>
      <div className={styles.chips} role="group" aria-label="Music you listen to">
        {choices.map((choice) => {
          const nothingNew = choice.newTagCount === 0;
          const selected = chosen.has(choice.key);
          const showAdded = Boolean(onAdded) && nothingNew;
          const detail = nothingNew ? "Already in your tags" : plural(choice.newTagCount, "new tag");
          return (
            <button
              key={choice.key}
              type="button"
              className={`${styles.chip} ${selected ? styles.selected : ""} ${showAdded ? styles.added : ""}`}
              aria-pressed={selected}
              disabled={busy || nothingNew}
              title={`${choice.sampleTags.join(", ")}… (${detail})`}
              onClick={() => toggle(choice.key)}
            >
              {(selected || showAdded) && <Check size={12} strokeWidth={3} aria-hidden="true" />}
              {choice.name}
              {showAdded && <span className={styles.addedLabel}>Added</span>}
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} disabled={chosen.size === 0 || busy} onClick={() => void add()}>
          {busy ? "Adding your tags…" : chosen.size ? `Add ${plural(chosen.size, "pack")}` : "Add packs"}
        </button>
        {onSkip && <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onSkip}>{skipLabel}</button>}
        {problem && <span className={styles.problem} role="alert">{problem}</span>}
      </div>
    </div>
  );
}
