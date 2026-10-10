import React from "react";
import styles from "./EntityDetailsCard.module.css";

export type EntityKind = "album" | "playlist" | "artist";

export interface EntityMetaItem {
  key: string;
  content: React.ReactNode;
  title?: string;
}

interface EntityDetailsCardProps {
  kind: EntityKind;
  name: string;
  imageUrl: string | null;
  meta: EntityMetaItem[];
  description?: string | null;
  /** Tooltip for the cover and title, which both open the item in Spotify. */
  openTitle: string;
  onOpen: () => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

const EYEBROWS: Record<EntityKind, string> = {
  album: "Album",
  playlist: "Playlist",
  artist: "Artist",
};

const COVER_CLASSES: Record<EntityKind, string> = {
  album: styles.albumCover,
  playlist: styles.playlistCover,
  artist: styles.artistCover,
};

/** The selected album, playlist, or artist: who it is, then what you've set on it. */
export function EntityDetailsCard({
  kind,
  name,
  imageUrl,
  meta,
  description,
  openTitle,
  onOpen,
  actions,
  children,
}: EntityDetailsCardProps) {
  return (
    <section className={styles.card}>
      <header className={styles.header}>
        {/* The title is the keyboard path to Spotify; the cover is a larger target for pointers. */}
        <button
          type="button"
          className={`${styles.cover} ${COVER_CLASSES[kind]}`}
          onClick={onOpen}
          title={openTitle}
          aria-label={openTitle}
          tabIndex={-1}
        >
          {imageUrl ? (
            <img src={imageUrl} alt="" className={styles.coverImage} />
          ) : (
            <span className={styles.coverPlaceholder} aria-hidden="true">♪</span>
          )}
        </button>

        <div className={styles.titleBlock}>
          <p className={styles.eyebrow}>{EYEBROWS[kind]}</p>
          <h2 className={styles.title}>
            <button type="button" className={styles.titleButton} onClick={onOpen} title={openTitle}>
              {name}
            </button>
          </h2>
          {meta.length > 0 ? (
            <p className={styles.meta}>
              <span className={styles.metaItems}>
                {meta.map((item) => (
                  <span key={item.key} title={item.title}>
                    {item.content}
                  </span>
                ))}
              </span>
            </p>
          ) : null}
          {description ? <p className={styles.description} title={description}>{description}</p> : null}
        </div>

        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </header>

      {children}
    </section>
  );
}

interface EntityIconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}

/** A compact header action whose purpose is given by its tooltip and accessible name. */
export function EntityIconButton({ label, onClick, children }: EntityIconButtonProps) {
  return (
    <button type="button" className={styles.iconButton} onClick={onClick} title={label} aria-label={label}>
      {children}
    </button>
  );
}
