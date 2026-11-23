import React, { useEffect, useMemo, useState } from "react";
import { Check, ExternalLink, Plus, Star } from "lucide-react";
import { sameTagNameKey, type PublicContributorV1 } from "@tagify/community-contracts";
import { lookupCommunityEntity, peekCommunityEntity, type CommunityEntityLookup } from "@/features/community/communityEntityCache";
import { COMMUNITY_PAGES_ORIGIN, communityTagLinkTitle, getCommunityEntityUrl, getCommunityTagUrl, openCommunityUrl } from "@/features/community/communityLinks";
import type { TaggedByOthersItem } from "@/features/community/taggedByOthers/taggedByOthersScan";
import type { CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import styles from "./TrackCommunityPanel.module.css";

interface TrackCommunityPanelProps {
  uri: string;
  songName: string;
  others: TaggedByOthersItem;
  /** Same-name keys of the tags already on this song. */
  songTagKeys: ReadonlySet<string>;
  /** Same-name keys of every tag in the member's library. */
  libraryTagKeys: ReadonlySet<string>;
  /** Where a tag the library doesn't have yet would be filed, such as "Mood / Feel" or "From Community". */
  destinationOf: (tag: CommunityMatchTag) => string;
  /** The member's own Community handle, left out of the people list. */
  ownHandle: string | null;
  /** Puts these members' tags on the song, adding any the library doesn't have yet. */
  onAdd: (tags: CommunityMatchTag[]) => Promise<void>;
  lookup?: typeof lookupCommunityEntity;
}

interface Member {
  handle: string;
  displayName: string;
  /** Their rating in stars (0.5 to 5), or null when they didn't rate it. */
  stars: number | null;
}

const TRACK_PREFIX = "spotify:track:";

const starsText = (stars: number) => (Number.isInteger(stars) ? `${stars}` : stars.toFixed(1));

function membersOf(lookup: CommunityEntityLookup | null | undefined, ownHandle: string | null): Member[] {
  const own = ownHandle?.toLowerCase() ?? "";
  return (lookup?.entity?.contributors ?? [])
    .filter((contributor: PublicContributorV1) => !contributor.isOwn && contributor.handle.toLowerCase() !== own)
    .map((contributor) => ({
      handle: contributor.handle,
      displayName: contributor.displayName,
      stars: typeof contributor.ratingHalfStars === "number" && contributor.ratingHalfStars > 0 ? contributor.ratingHalfStars / 2 : null,
      tagged: (contributor.tags ?? []).length > 0,
    }))
    .filter((member) => member.tagged || member.stars !== null);
}

/**
 * Other members' tags and ratings on one song in the track list, opened from the row's "N others" chip:
 * one line of their tags (each goes on the song with one click, and into the library, in the folder
 * it would be filed in, when it's new there), then who tagged it with their ratings. The song's Community page and each member's profile
 * are one click away.
 */
export function TrackCommunityPanel({ uri, songName, others, songTagKeys, libraryTagKeys, destinationOf, ownHandle, onAdd, lookup = lookupCommunityEntity }: TrackCommunityPanelProps) {
  const providerId = uri.startsWith(TRACK_PREFIX) ? uri.slice(TRACK_PREFIX.length) : null;
  const [answer, setAnswer] = useState<CommunityEntityLookup | null>(() => (providerId ? peekCommunityEntity("track", providerId) ?? null : null));
  const [checking, setChecking] = useState(!answer);
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening the panel asks Community once for who rated and tagged the song; the answer is shared for the session.
  useEffect(() => {
    if (!providerId) { setChecking(false); return; }
    let live = true;
    setChecking(true);
    void lookup("track", providerId).then((result) => {
      if (!live) return;
      setAnswer(result);
      setChecking(false);
    });
    return () => { live = false; };
  }, [lookup, providerId]);

  const members = useMemo(() => membersOf(answer, ownHandle), [answer, ownHandle]);
  const rated = members.filter((member) => member.stars !== null);
  const average = rated.length ? rated.reduce((sum, member) => sum + (member.stars ?? 0), 0) / rated.length : null;

  const isOn = (tag: CommunityMatchTag) => {
    const key = sameTagNameKey(tag.label);
    return songTagKeys.has(key) || added.has(key);
  };
  const isNew = (tag: CommunityMatchTag) => !libraryTagKeys.has(sameTagNameKey(tag.label));

  // One tag at a time (Alex, 2026-11-15: "let's remove \"Add all\" - no one will want to press that.").
  const add = async (tags: CommunityMatchTag[]) => {
    const wanted = tags.filter((tag) => !isOn(tag));
    if (busy || !wanted.length) return;
    setBusy(true);
    setError(null);
    try {
      const newToLibrary = wanted.some(isNew);
      await onAdd(wanted);
      setAdded((current) => new Set([...current, ...wanted.map((tag) => sameTagNameKey(tag.label))]));
      // Counted once the tags are saved, never for a click that failed.
      recordProductInteraction("track_list_members_tag_added", { members_add: "tag", new_to_library: newToLibrary ? "yes" : "no" });
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Tagify couldn't add those tags. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const songUrl = getCommunityEntityUrl(uri);
  const openTag = (label: string) => {
    openCommunityUrl(getCommunityTagUrl(label));
    recordProductInteraction("track_list_community_link_opened", { target: "tag" });
  };
  const fallbackWho = others.sample.length ? others.sample.map((handle) => `@${handle}`).join(", ") : null;

  return (
    <div className={styles.panel} role="region" aria-label={`Other members' tags on ${songName}`}>
      <div className={styles.tray}>
        <span className={styles.trayLabel}>Their tags</span>
        {others.tags.map((tag) => {
          const on = isOn(tag);
          const fresh = !on && isNew(tag);
          const title = on ? `${tag.label} is on this song`
            : fresh ? `Add ${tag.label} to this song. It's new to your library, so it goes in ${destinationOf(tag)}.`
            : `Add ${tag.label} to this song`;
          return (
            <span key={tag.label} className={`${styles.chip} ${on ? styles.chipOn : ""}`}>
              <button type="button" className={styles.chipAdd} disabled={busy || on}
                aria-label={on ? `${tag.label} added to ${songName}` : `Add ${tag.label} to ${songName}`} title={title}
                onClick={() => void add([tag])}>
                {on ? <Check size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
              </button>
              <button type="button" className={styles.chipLink} title={communityTagLinkTitle(tag.label)} aria-label={communityTagLinkTitle(tag.label)}
                onClick={(event) => { event.stopPropagation(); openTag(tag.label); }}>
                <span>{tag.label}</span>
                {tag.people > 1 ? <span className={styles.count}>{tag.people}</span> : null}
                {fresh ? <span className={styles.newTag}>new</span> : null}
              </button>
            </span>
          );
        })}
      </div>
      <p className={styles.whoLine}>
        {checking && !members.length ? <span>Checking Community…</span>
          : !members.length && answer?.unavailable ? <span>Community can't be reached right now{fallbackWho ? `. Tagged by ${fallbackWho}` : ""}.</span>
          : (
            <>
              {members.map((member, index) => (
                <React.Fragment key={member.handle}>
                  {index > 0 ? <span className={styles.separator}>·</span> : null}
                  <button type="button" className={styles.handle} title={`See ${member.displayName || `@${member.handle}`} on Community`}
                    onClick={() => { openCommunityUrl(`${COMMUNITY_PAGES_ORIGIN}/@${member.handle}`); recordProductInteraction("track_list_community_link_opened", { target: "member" }); }}>
                    @{member.handle}
                  </button>
                  {member.stars !== null ? (
                    <span className={styles.stars} aria-label={`Rated ${starsText(member.stars)} stars`}>
                      <Star size={11} aria-hidden="true" fill="currentColor" />{starsText(member.stars)}
                    </span>
                  ) : null}
                </React.Fragment>
              ))}
              {average !== null ? (
                <span className={styles.averageGroup}>
                  <span className={styles.separator}>—</span>
                  <span className={styles.average}>
                    <Star size={12} aria-hidden="true" fill="currentColor" />
                    {starsText(Math.round(average * 10) / 10)} average · {rated.length} {rated.length === 1 ? "rating" : "ratings"}
                  </span>
                </span>
              ) : null}
            </>
          )}
        {songUrl ? (
          <button type="button" className={`${styles.link} ${styles.linkEnd}`} onClick={() => { openCommunityUrl(songUrl); recordProductInteraction("track_list_community_link_opened", { target: "song" }); }}>
            Open on Community <ExternalLink size={12} aria-hidden="true" />
          </button>
        ) : null}
      </p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
