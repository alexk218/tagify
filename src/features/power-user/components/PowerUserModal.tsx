import React, { useState } from "react";
import { Portal } from "@/components/ui";
import { InviteFriendsPanel } from "@/features/invite";
import styles from "./PowerUserModal.module.css";

interface PowerUserModalProps {
  taggedTrackCount: number;
  onClose: () => void;
  /** Opens Community setup from the invite, so it can carry the member's name. */
  onConnectCommunity: () => void;
  /** Opens the Sync dialog from the invite, where the member makes their tags public. */
  onOpenSync: () => void;
}

const GITHUB_URL = "https://github.com/alexk218/tagify";
const WEBSITE_URL = "https://www.tagify.fm";
const PROMO_VIDEO_URL = "https://www.youtube.com/watch?v=iDsSasHFOJQ";

const PowerUserModal: React.FC<PowerUserModalProps> = ({
  taggedTrackCount,
  onClose,
  onConnectCommunity,
  onOpenSync,
}) => {
  const [inviting, setInviting] = useState(false);
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
          {inviting ? (
            <div className={styles.content}>
              <InviteFriendsPanel entry="milestone" onConnectCommunity={onConnectCommunity} onOpenSync={onOpenSync} />
            </div>
          ) : (
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
            <p>
              Know someone who'd love Tagify too? Sending them an invite is
              the best way to help it grow 💚
            </p>
            <p>Thank you.</p>

            <p className={styles.signature}>- Alex</p>
          </div>
          )}
          <div className={styles.footer}>
            {inviting ? (
              <button className={styles.closeButton} onClick={() => setInviting(false)}>
                Back
              </button>
            ) : (
              <>
                <button
                  className={styles.primaryButton}
                  onClick={() => setInviting(true)}
                >
                  Invite a friend
                </button>
                <button
                  className={styles.secondaryButton}
                  onClick={() => openExternalLink(GITHUB_URL)}
                >
                  Star on GitHub
                </button>
                <button className={styles.closeButton} onClick={onClose}>
                  Close
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
};

export default PowerUserModal;
