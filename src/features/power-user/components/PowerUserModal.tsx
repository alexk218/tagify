import React from "react";
import { Portal } from "@/components/ui";
import styles from "./PowerUserModal.module.css";

interface PowerUserModalProps {
  taggedTrackCount: number;
  onClose: () => void;
}

const GITHUB_URL = "https://github.com/alexk218/tagify";
const WEBSITE_URL = "https://www.tagify.fm";
const PROMO_VIDEO_URL = "https://www.youtube.com/watch?v=iDsSasHFOJQ";

const PowerUserModal: React.FC<PowerUserModalProps> = ({
  taggedTrackCount,
  onClose,
}) => {
  const openExternalLink = (url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <Portal>
      <div className={styles.overlay}>
        <div className={styles.modal}>
          <div className={styles.header}>
            <div className={styles.badgeWrap} aria-hidden="true">
              <span className={styles.sparkleA}>✦</span>
              <span className={styles.sparkleB}>✧</span>
              <span className={styles.sparkleC}>✦</span>
              <div className={styles.badge}>💚</div>
            </div>
            <h2 className={styles.title}>You are a Tagify power user</h2>
          </div>
          <div className={styles.content}>
            <p className={styles.highlight}>
              You've tagged{" "}
              <strong>{taggedTrackCount.toLocaleString()} tracks</strong>.
            </p>

            <p>
              That's huge. Knowing that Tagify has become part of how you
              organize your music genuinely means a lot to me.
            </p>

            <p>
              I'm building Tagify to be the best music organization tool out
              there, and I'm committed to keeping it free. But I can't do it
              alone.
            </p>

            <p className={styles.ask}>
              If Tagify has made a difference in how you organize your music,
              would you consider giving it a star on{" "}
              <a
                className={styles.inlineLink}
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
              ?
            </p>

            <p>
              And if you want to help out even more, a like and comment on the{" "}
              <a
                className={styles.inlineLink}
                href={PROMO_VIDEO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                promo video
              </a>{" "}
              at{" "}
              <a
                className={styles.inlineLink}
                href={WEBSITE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                tagify.fm
              </a>{" "}
              would mean the world.
            </p>
            <p>Your support helps others discover Tagify.</p>
            <p>Thank you.</p>

            <p className={styles.signature}>- Alex</p>
          </div>
          <div className={styles.footer}>
            <button
              className={styles.primaryButton}
              onClick={() => openExternalLink(GITHUB_URL)}
            >
              Star on GitHub
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => openExternalLink(PROMO_VIDEO_URL)}
            >
              Promo video (like & comment!)
            </button>
            <button className={styles.closeButton} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default PowerUserModal;
