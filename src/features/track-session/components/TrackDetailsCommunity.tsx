import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Plus, Star, Users } from "lucide-react";
import { sameTagNameKey, type PublicEntityViewV1 } from "@tagify/community-contracts";
import { lookupCommunityEntity, peekCommunityEntity, type CommunityEntityLookup } from "@/features/community/communityEntityCache";
import { COMMUNITY_PAGES_ORIGIN, getCommunityEntityUrl, openCommunityUrl } from "@/features/community/communityLinks";
import type { CommunityMatchTag } from "@/features/onboarding/services/communityMatches";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { recordCommunityTeaserViewed } from "@/features/community/taggedByOthers/communityTeaserPreview";
import styles from "./TrackDetailsCommunity.module.css";

interface TrackDetailsCommunityProps {
  uri: string;
  songName: string;
  /** Same-name keys of the tags already on this song. */
  songTagKeys: ReadonlySet<string>;
  /** Same-name keys of every tag in the library. */
  libraryTagKeys: ReadonlySet<string>;
  /** Where a tag new to the library would be filed, such as "Mood / Feel". */
  destinationOf: (tag: CommunityMatchTag) => string;
  ownHandle: string | null;
  /** Puts these tags on the song, adding any the library doesn't have yet. Without it the tags are read-only. */
  onAdd?: (tags: CommunityMatchTag[]) => Promise<void>;
  /** Tells the header whether Community has a page for this song. */
  onAvailabilityChange?: (entityUri: string, hasPerspectives: boolean, found: boolean) => void;
  lookup?: typeof lookupCommunityEntity;
  /** Not connected to Community: the tags stay read-only and a line asks them to connect to add them. */
  onConnect?: () => void;
}

export interface MemberTag extends CommunityMatchTag {
  /** Handles of the members who use it, in the order Community lists them. */
  handles: string[];
}

interface Member {
  handle: string;
  displayName: string;
  stars: number | null;
  tags: string[];
}

const TRACK_PREFIX = "spotify:track:";
const starsText = (stars: number) => (Number.isInteger(stars) ? `${stars}` : stars.toFixed(1));

function membersOf(entity: PublicEntityViewV1 | null | undefined, ownHandle: string | null): Member[] {
  const own = ownHandle?.toLowerCase() ?? "";
  return (entity?.contributors ?? [])
    .filter((contributor) => !contributor.isOwn && contributor.handle.toLowerCase() !== own)
    .map((contributor) => ({
      handle: contributor.handle,
      displayName: contributor.displayName,
      stars: typeof contributor.ratingHalfStars === "number" && contributor.ratingHalfStars > 0 ? contributor.ratingHalfStars / 2 : null,
      tags: [...new Set((contributor.tags ?? []).map((tag) => (typeof tag.label === "string" ? tag.label.trim() : "")).filter(Boolean))],
    }))
    .filter((member) => member.tags.length > 0 || member.stars !== null);
}

/** Every tag other members put on the song, most people first, each with its most common place and who uses it. */
export function memberTagsOf(entity: PublicEntityViewV1 | null | undefined, ownHandle: string | null): MemberTag[] {
  const own = ownHandle?.toLowerCase() ?? "";
  const tags = new Map<string, { label: string; handles: string[]; paths: Map<string, number> }>();
  for (const contributor of entity?.contributors ?? []) {
    if (contributor.isOwn || contributor.handle.toLowerCase() === own) continue;
    const seen = new Set<string>();
    for (const { label, path } of contributor.tags ?? []) {
      const name = typeof label === "string" ? label.trim() : "";
      const key = sameTagNameKey(name);
      if (!name || seen.has(key)) continue;
      seen.add(key);
      const tag = tags.get(key) ?? { label: name, handles: [] as string[], paths: new Map<string, number>() };
      tag.handles.push(contributor.handle);
      const place = typeof path === "string" && path.trim() ? path.trim() : name;
      tag.paths.set(place, (tag.paths.get(place) ?? 0) + 1);
      tags.set(key, tag);
    }
  }
  return [...tags.values()]
    .sort((a, b) => b.handles.length - a.handles.length || a.label.localeCompare(b.label))
    .map(({ label, handles, paths }) => ({
      label,
      handles,
      people: handles.length,
      paths: [...paths].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([place]) => place),
    }));
}

const whoText = (handles: string[]) => {
  const named = handles.slice(0, 3).map((handle) => `@${handle}`).join(", ");
  return handles.length > 3 ? `${named} and ${handles.length - 3} more` : named;
};

/**
 * Other members' tags and ratings on the song in track details. Each tag goes on the song with one
 * click (new names are filed where the track list would file them); hovering one says who uses it.
 * Nothing shows until Community answers, and nothing at all when no one else tagged or rated the song.
 */
export function TrackDetailsCommunity({
  uri, songName, songTagKeys, libraryTagKeys, destinationOf, ownHandle, onAdd: onAddWhenConnected, onAvailabilityChange, onConnect,
  lookup = lookupCommunityEntity,
}: TrackDetailsCommunityProps) {
  const onAdd = onConnect ? undefined : onAddWhenConnected;
  const providerId = uri.startsWith(TRACK_PREFIX) ? uri.slice(TRACK_PREFIX.length) : null;
  const [answer, setAnswer] = useState<{ uri: string; lookup: CommunityEntityLookup } | null>(() => {
    const known = providerId ? peekCommunityEntity("track", providerId) : undefined;
    return known ? { uri, lookup: known } : null;
  });
  const [added, setAdded] = useState<{ uri: string; keys: ReadonlySet<string> }>({ uri, keys: new Set() });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const songTagKeysRef = useRef(songTagKeys);
  songTagKeysRef.current = songTagKeys;

  // A tag just added counts as on the song only until the song's own tags list it. After that the
  // song's tags decide, so a tag removed from the song can be added again.
  useEffect(() => {
    setAdded((prev) => {
      const pending = [...prev.keys].filter((key) => !songTagKeys.has(key));
      return pending.length === prev.keys.size ? prev : { uri: prev.uri, keys: new Set(pending) };
    });
  }, [songTagKeys]);

  useEffect(() => {
    setError(null);
    if (!providerId) return;
    let live = true;
    const known = peekCommunityEntity("track", providerId);
    if (known) setAnswer({ uri, lookup: known });
    void lookup("track", providerId).then((result) => {
      if (live) setAnswer({ uri, lookup: result });
    });
    return () => { live = false; };
  }, [lookup, providerId, uri]);

  const current = answer?.uri === uri ? answer.lookup : null;
  const members = useMemo(() => membersOf(current?.entity, ownHandle), [current, ownHandle]);
  const tags = useMemo(() => memberTagsOf(current?.entity, ownHandle), [current, ownHandle]);

  useEffect(() => {
    if (current && !current.unavailable) onAvailabilityChange?.(uri, members.length > 0, current.found);
  }, [current, members.length, onAvailabilityChange, uri]);

  const teaserShown = Boolean(onConnect && current && members.length);
  useEffect(() => {
    if (teaserShown) recordCommunityTeaserViewed("track_details");
  }, [teaserShown]);
  if (!current || !members.length) return null;

  const addedKeys = added.uri === uri ? added.keys : new Set<string>();
  const isOn = (tag: MemberTag) => songTagKeys.has(sameTagNameKey(tag.label)) || addedKeys.has(sameTagNameKey(tag.label));
  const isNew = (tag: MemberTag) => !libraryTagKeys.has(sameTagNameKey(tag.label));
  const rated = members.filter((member) => member.stars !== null);
  const average = rated.length ? rated.reduce((sum, member) => sum + (member.stars ?? 0), 0) / rated.length : null;
  const songUrl = getCommunityEntityUrl(uri);

  const add = async (tag: MemberTag) => {
    if (!onAdd || busy || isOn(tag)) return;
    const key = sameTagNameKey(tag.label);
    setBusy(key);
    setError(null);
    try {
      const newToLibrary = isNew(tag);
      await onAdd([{ label: tag.label, paths: tag.paths, people: tag.people }]);
      if (!songTagKeysRef.current.has(key)) {
        setAdded((prev) => ({ uri, keys: new Set([...(prev.uri === uri ? prev.keys : []), key]) }));
      }
      recordProductInteraction("track_list_members_tag_added", { members_add: "tag", new_to_library: newToLibrary ? "yes" : "no" });
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "Tagify couldn't add that tag. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const openMember = (handle: string) => {
    openCommunityUrl(`${COMMUNITY_PAGES_ORIGIN}/@${handle}`);
    recordProductInteraction("track_list_community_link_opened", { target: "member" });
  };
  const openSong = () => {
    if (!songUrl) return;
    openCommunityUrl(songUrl);
    recordProductInteraction("track_list_community_link_opened", { target: "song" });
  };

  const chip = (tag: MemberTag) => {
    const on = isOn(tag);
    const fresh = !on && isNew(tag);
    const who = `Tagged by ${whoText(tag.handles)}`;
    const title = on ? `${tag.label} is on this song. ${who}.`
      : !onAdd ? `${who}.`
      : fresh ? `Add ${tag.label} to this song. It's new to your library, so it goes in ${destinationOf(tag)}. ${who}.`
      : `Add ${tag.label} to this song. ${who}.`;
    return (
      <button key={tag.label} type="button"
        className={`${styles.chip} ${on ? styles.chipOn : ""}`}
        disabled={!onAdd || on || busy !== null} title={title}
        aria-label={on ? `${tag.label} is on ${songName}` : `Add ${tag.label} to ${songName}`}
        onClick={() => void add(tag)}>
        {on ? <Check size={12} aria-hidden="true" /> : onAdd ? <Plus size={12} aria-hidden="true" /> : null}
        <span>{tag.label}</span>
        {tag.people > 1 ? <span className={styles.count}>{tag.people}</span> : null}
        {fresh && onAdd ? <span className={styles.newTag}>new</span> : null}
      </button>
    );
  };

  const header = (
    <div className={styles.header}>
      <h3 className={styles.title}>From Community</h3>
      <span className={styles.meta}>
        <Users size={12} aria-hidden="true" />
        {members.length} {members.length === 1 ? "member" : "members"}
        {average !== null ? (
          <span className={styles.average}>
            <Star size={11} aria-hidden="true" fill="currentColor" />
            {starsText(Math.round(average * 10) / 10)}
          </span>
        ) : null}
      </span>
      {songUrl ? (
        <button type="button" className={styles.link} onClick={openSong}>
          Open on Community <ExternalLink size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );

  const handle = (member: Member) => (
    <button type="button" className={styles.handle} title={`See ${member.displayName || `@${member.handle}`} on Community`} onClick={() => openMember(member.handle)}>
      @{member.handle}
    </button>
  );
  const stars = (member: Member) => member.stars !== null ? (
    <span className={styles.stars} aria-label={`Rated ${starsText(member.stars)} stars`}>
      <Star size={11} aria-hidden="true" fill="currentColor" />{starsText(member.stars)}
    </span>
  ) : null;

  return (
    <section className={styles.section} aria-label={`Other members' tags on ${songName}`}>
      {header}
      {tags.length ? <div className={styles.tray}>{tags.map(chip)}</div> : null}
      {onConnect ? (
        <p className={styles.connectLine}>
          Connect to Tagify Community to add these tags to your song.
          <button type="button" className={styles.connectButton} onClick={onConnect}>Connect</button>
        </p>
      ) : null}
      <p className={styles.whoLine}>
        {members.map((member, index) => (
          <React.Fragment key={member.handle}>
            {index > 0 ? <span className={styles.separator}>·</span> : null}
            <span className={styles.whoItem}>{handle(member)}{stars(member)}</span>
          </React.Fragment>
        ))}
      </p>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
