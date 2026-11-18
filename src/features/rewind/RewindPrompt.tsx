import React from "react";
// eslint-disable-next-line css-modules/no-unused-class -- shared with the Community invitations
import promptStyles from "../community/CommunityConnectPrompt.module.css";
import styles from "./RewindPrompt.module.css";
import { REWIND_YEAR } from "./rewindPromptRules";

interface RewindPromptProps {
  /** Songs first tagged this year, counted on this device. */
  songs: number;
  /** Whether this device already backs up to Community. */
  connected: boolean;
  onOpen: () => void;
  onDismiss: () => void;
}

/**
 * "Your Rewind 2026 is ready": the year's one number, in the same banner as the Community
 * invitations, with the rest of the year behind the button.
 */
export function RewindPrompt({ songs, connected, onOpen, onDismiss }: RewindPromptProps) {
  return (
    <section className={`${promptStyles.prompt} ${promptStyles.connect}`} aria-labelledby="rewind-prompt-title" aria-describedby="rewind-prompt-description">
      <div className={styles.number}>
        <strong>{songs.toLocaleString("en-US")}</strong>
        <span>songs tagged in {REWIND_YEAR}</span>
      </div>
      <div className={promptStyles.text}>
        <h2 id="rewind-prompt-title" className={promptStyles.title}>Your Rewind {REWIND_YEAR} is ready</h2>
        <p id="rewind-prompt-description" className={promptStyles.description}>
          {connected
            ? "Your top tags, busiest month and longest streak are on Community."
            : "See your top tags, busiest month and longest streak on Community. Connecting backs up your library there, and your tags stay private unless you publish them."}
        </p>
      </div>
      <div className={`${promptStyles.actions} ${styles.actions}`}>
        <button type="button" className={promptStyles.secondary} onClick={onDismiss}>Not now</button>
        <button type="button" className={promptStyles.primary} onClick={onOpen}>See your full Rewind on Community</button>
      </div>
    </section>
  );
}
