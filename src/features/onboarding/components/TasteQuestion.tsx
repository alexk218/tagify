import React, { useEffect, useRef, useState } from "react";
import { Portal } from "@/components/ui";
import type { TastePackChoice } from "@/utils/tastePackTaxonomy";
import styles from "./TasteQuestion.module.css";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export interface TasteQuestionProps {
  choices: readonly TastePackChoice[];
  /** Saves the answer: the ticked packs for Continue, none for Skip. */
  onAnswer: (keys: string[]) => Promise<void>;
}

/**
 * "What do you listen to?" for a new desktop library, worded like the Community website and iPhone:
 * music types as tick boxes, the exact tags they add, then Continue or Skip.
 */
export function TasteQuestion({ choices, onAnswer }: TasteQuestionProps) {
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<"add" | "skip" | null>(null);
  const [problem, setProblem] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const toggle = (key: string) => setChosen((current) => {
    const next = new Set(current);
    if (!next.delete(key)) next.add(key);
    return next;
  });

  const answer = async (kind: "add" | "skip") => {
    setProblem("");
    setBusy(kind);
    try {
      await onAnswer(kind === "add" ? choices.filter((choice) => chosen.has(choice.key)).map((choice) => choice.key) : []);
    } catch (error) {
      console.error("Tagify: The answer to What do you listen to? could not be saved", error);
      setProblem(kind === "add" ? "Your tags couldn't be added. Try again in a moment." : "That didn't go through. Try again in a moment.");
      setBusy(null);
    }
  };

  const picked = choices.filter((choice) => chosen.has(choice.key));
  const previewed = [...new Set(picked.flatMap((choice) => choice.tags))];

  const body = (
    <>
      <h2 id="taste-question-title" className={styles.title} ref={headingRef} tabIndex={-1}>What do you listen to?</h2>
      <p className={styles.lead}>Pick a few and we&apos;ll set up tags that fit. Nothing&apos;s final, you can change them anytime.</p>
      <div className={styles.choices} role="group" aria-label="Music you listen to">
        {choices.map((choice) => (
          <label key={choice.key} className={`${styles.choice} ${chosen.has(choice.key) ? styles.chosen : ""}`}>
            <input type="checkbox" checked={chosen.has(choice.key)} disabled={busy !== null} onChange={() => toggle(choice.key)} />
            <span>{choice.name}</span>
          </label>
        ))}
      </div>
      {previewed.length ? (
        <div className={styles.preview}>
          <p className={styles.note}>These {plural(previewed.length, "tag")} go into Genre &amp; Style:</p>
          <ul className={styles.tags} aria-label="Tags these add">
            {previewed.map((name) => <li key={name} className={styles.tag}>{name}</li>)}
          </ul>
        </div>
      ) : (
        <p className={styles.note}>Pick one to see exactly which tags it adds.</p>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.primaryButton} disabled={chosen.size === 0 || busy !== null} onClick={() => void answer("add")}>
          {busy === "add" ? "Adding your tags…" : "Continue"}
        </button>
        <button type="button" className={styles.secondaryButton} disabled={busy !== null} onClick={() => void answer("skip")}>
          {busy === "skip" ? "Skipping…" : "Skip"}
        </button>
        {problem && <span className={styles.problem} role="alert">{problem}</span>}
      </div>
    </>
  );

  return (
    <Portal>
      <div className={styles.overlay}>
        <div className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="taste-question-title">{body}</div>
      </div>
    </Portal>
  );
}
