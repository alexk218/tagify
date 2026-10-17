import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseSpotifyEntity } from "@tagify/community-contracts";
import { ChevronDown, Users } from "lucide-react";
import { lookupCommunityEntity, peekCommunityEntity, type CommunityEntityLookup } from "./communityEntityCache";
import styles from "./CommunityEntityLens.module.css";

/**
 * Community perspectives for the item in a detail view. Nothing is fetched
 * until the lens is opened: what this session already learned shows straight
 * away, and opening it checks Community for newer tags.
 */
export function CommunityEntityLens({ entityUri, onAvailabilityChange }: {
  entityUri: string;
  /** `found`: Community has a page for the item. Reported from what is known, and again after each check. */
  onAvailabilityChange?: (entityUri: string, hasPerspectives: boolean, found: boolean) => void;
}) {
  const entityRef = useMemo(() => parseSpotifyEntity(entityUri), [entityUri]);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const currentUri = useRef(entityUri);
  const [answer, setAnswer] = useState<{ entityUri: string; lookup: CommunityEntityLookup | null; checking: boolean }>({ entityUri, lookup: null, checking: false });

  const report = useCallback((uri: string, lookup: CommunityEntityLookup | null | undefined) => {
    onAvailabilityChange?.(uri, Boolean(lookup?.entity?.contributors?.length), Boolean(lookup?.found));
  }, [onAvailabilityChange]);

  const check = useCallback(() => {
    if (!entityRef) return;
    const uri = entityUri;
    setAnswer((previous) => ({ entityUri: uri, lookup: previous.entityUri === uri ? previous.lookup : null, checking: true }));
    void lookupCommunityEntity(entityRef.kind, entityRef.providerId).then((lookup) => {
      if (currentUri.current !== uri) return;
      setAnswer({ entityUri: uri, lookup, checking: false });
      report(uri, lookup);
    });
  }, [entityRef, entityUri, report]);

  useEffect(() => {
    currentUri.current = entityUri;
    const cached = entityRef ? peekCommunityEntity(entityRef.kind, entityRef.providerId) : undefined;
    setAnswer({ entityUri, lookup: cached ?? null, checking: false });
    report(entityUri, cached);
    // Left open while the song changes: the listener is reading it, so check the new one.
    if (detailsRef.current?.open) check();
    // `check` changes only with the entity, so this still runs once per entity.
  }, [check, entityRef, entityUri, report]);

  if (!entityRef) return null;

  const current = answer.entityUri === entityUri ? answer : { lookup: null, checking: false };
  const contributors = current.lookup?.entity?.contributors ?? [];

  return (
    <details
      ref={detailsRef}
      className={styles.lens}
      onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) check(); }}
    >
      <summary>
        <span>
          <Users size={15} /> Community perspectives
        </span>
        <span>
          {contributors.length > 0 ? (
            <small>
              {contributors.length} contributor{contributors.length === 1 ? "" : "s"}
            </small>
          ) : null}
          <ChevronDown size={14} aria-hidden="true" className={styles.chevron} />
        </span>
      </summary>
      <div className={styles.body}>
        {contributors.length > 0 ? (
          <div className={styles.contributors}>
            {contributors.map((contributor) => (
              <article
                key={contributor.handle}
                className={contributor.isOwn ? styles.ownContributor : undefined}
              >
                <span>
                  <strong>{contributor.isOwn ? "You" : contributor.displayName}</strong>
                  {contributor.isOwn ? <small>Your public tags</small> : null}
                </span>
                {contributor.tags.length > 0 ? (
                  <p>{contributor.tags.map((tag) => tag.label).join(" · ")}</p>
                ) : (
                  <p className={styles.message}>No public tags for this track.</p>
                )}
              </article>
            ))}
          </div>
        ) : current.checking || !current.lookup ? (
          <p className={styles.message}>Checking Community…</p>
        ) : current.lookup.unavailable ? (
          <p className={styles.message}>Community can’t be reached right now. Close and reopen this to try again.</p>
        ) : (
          <p className={styles.message}>No one has shared public tags for this yet.</p>
        )}
      </div>
    </details>
  );
}
