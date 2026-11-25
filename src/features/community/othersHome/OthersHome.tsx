import React, { useMemo, useState } from "react";
import { CommunityTagSearch, tagsText } from "../tagSearch/CommunityTagResults";
import { TAG_SEARCH_MAX_TAGS, type TagSearchMatch } from "../tagSearch/tagSearchClient";
import { OthersHomeContext, type ChosenTags, type OthersHomeReports, type TagNameCount } from "./othersHomeContext";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import styles from "./OthersHome.module.css";

export type OthersHomeView = "yours" | "new";
/** How the member got to the list: the tab or its switch, the line under a tag filter, or it was showing when the page opened. */
export type OthersEntry = "tab" | "filter_link" | "restored";
export type { ChosenTags };
interface OthersHomeProps {
  /** The member's songs other members tagged: the list the tab has always shown. */
  yourSongs: React.ReactNode;
  /** Missing while Community's tag search is off: the tab is then only "Your songs". */
  tagSearch?: { viewer: string; onConnect: () => void; onShare: () => void; onPlay: (uri: string) => void };
  /** The member's own tag names, most used first. */
  ownTags: readonly string[];
  view: OthersHomeView;
  onView: (view: OthersHomeView) => void;
  /** The tags chosen for both lists. */
  chosen: ChosenTags;
  onChoose: (chosen: ChosenTags) => void;
  /** Spotify saved a "New to you" song to Liked Songs. */
  onSongSaved?: () => void;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** A tag to offer, with how many of the songs showing carry it when that is known. */
interface Suggestion { label: string; songs?: number }

/**
 * The track list's "Tagged by others" tab as the one home for other members' songs: the member's own
 * songs others tagged, and songs tagged a chosen way that the member doesn't have. The tags chosen
 * apply to both lists, picked in the Filters menu: the names others used on the member's songs while
 * "Your songs" shows, the member's own tags while "New to you" shows.
 */
export function OthersHome({ yourSongs, tagSearch, ownTags, view, onView, chosen, onChoose, onSongSaved }: OthersHomeProps) {
  const [found, setFound] = useState<number | null>(null);
  const [tagNames, setTagNames] = useState<readonly TagNameCount[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const reports = useMemo<OthersHomeReports>(() => ({
    onFound: setFound, onTagNames: setTagNames,
    tags: tagSearch ? { chosen, onChoose } : undefined,
  }), [tagSearch, chosen, onChoose]);
  const chosenAny = chosen.tags.length > 0;
  const results = (tags: readonly string[], match: TagSearchMatch) => tagSearch ? (
    <CommunityTagSearch tags={tags} match={match} viewer={tagSearch.viewer} bare saveInWords
      emptyText={`No songs tagged ${tagsText(tags, match)} by other members yet.`}
      afterSave={onSongSaved} onPlay={tagSearch.onPlay} onConnect={tagSearch.onConnect} onShare={tagSearch.onShare} />
  ) : null;

  if (!tagSearch) return <OthersHomeContext.Provider value={reports}>{yourSongs}</OthersHomeContext.Provider>;

  const showingNew = view === "new";
  const suggestions: readonly Suggestion[] = showingNew ? ownTags.map((label) => ({ label })) : tagNames;
  const chooseHere = (next: ChosenTags) => {
    // Same measurement as picking a tag name in "Your songs" before the bar moved above it.
    if (!showingNew && next.tags.length > chosen.tags.length) recordProductInteraction("tagged_by_others_filter_used", { filter_kind: "tag" });
    onChoose(next);
  };
  const countText = (count: number | null) => count ? <span className={styles.count}>{count.toLocaleString()}</span> : null;
  const filters = (
    <button type="button" className={`${styles.filterToggle} ${filtersOpen ? styles.filterToggleOpen : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}>
      Filters{chosenAny ? <span className={styles.filterBadge}>{chosen.tags.length}</span> : null}
    </button>
  );
  // While the menu is closed, the chosen tags stay in sight and each comes off with one click.
  const pills = !filtersOpen && chosenAny ? (
    <div className={styles.chosenPills} role="group" aria-label="Chosen tags">
      {chosen.tags.map((tag) => (
        <button key={tag.toLowerCase()} type="button" className={styles.chosenPill} title={`Stop looking for ${tag}`}
          onClick={() => onChoose({ tags: chosen.tags.filter((name) => !same(name, tag)), match: "any" })}>
          <span className={styles.chipName}>{tag}</span>
          <span aria-hidden="true" className={styles.chosenPillX}>×</span>
        </button>
      ))}
    </div>
  ) : null;
  const option = (value: OthersHomeView, title: string, count: React.ReactNode) => {
    const on = view === value;
    return (
      <button type="button" role="tab" aria-selected={on} className={`${styles.option} ${on ? styles.optionOn : ""}`} onClick={() => onView(value)}>
        {title}{count}
      </button>
    );
  };
  const switcher = (
    <div className={styles.switch} data-view={view} role="tablist" aria-label="Songs other members tagged">
      <span aria-hidden="true" className={styles.thumb} />
      {option("yours", "Your songs", countText(found))}
      {option("new", "New to you", null)}
    </div>
  );
  return (
    <OthersHomeContext.Provider value={reports}>
      {/* Filters and the tags picked in it at the start, the switch centered on the page. */}
      <div className={styles.row}>
        <div className={styles.rowStart}>{filters}{pills}</div>
        {switcher}
        <span />
      </div>
      {/* A new chooser per list: each offers its own names. */}
      {filtersOpen ? (
        <div className={styles.filterMenu}>
          <TagChooser key={view} suggestions={suggestions} chosen={chosen} onChoose={chooseHere} />
        </div>
      ) : null}
      {/* Kept in place while the other list shows, so its search, filters and place aren't lost. */}
      <div role="tabpanel" aria-label="Your songs" className={styles.yourSongs} style={showingNew ? { display: "none" } : undefined}>{yourSongs}</div>
      {showingNew ? (
        <div role="tabpanel" aria-label="New to you" className={styles.newToYou}>
          {chosenAny ? results(chosen.tags, chosen.match) : (
            <p className={styles.hint}>Choose a tag to see songs other members tagged that way that aren’t in your library yet.</p>
          )}
        </div>
      ) : null}
    </OthersHomeContext.Provider>
  );
}

/** Every tag to pick as a chip, chosen ones first, with a box to narrow them or look for any tag by name. */
function TagChooser({ suggestions: everySuggestion, chosen, onChoose }: { suggestions: readonly Suggestion[]; chosen: ChosenTags; onChoose: (chosen: ChosenTags) => void }) {
  const [typed, setTyped] = useState("");
  // A member can have the same tag name in two groups; Community looks by name, so it's one chip.
  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    return everySuggestion.filter(({ label: name }) => {
      const key = name.trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [everySuggestion]);
  const isChosen = (tag: string) => chosen.tags.some((name) => same(name, tag));
  const toggle = (tag: string) => {
    const tags = isChosen(tag) ? chosen.tags.filter((name) => !same(name, tag)) : [...chosen.tags, tag].slice(-TAG_SEARCH_MAX_TAGS);
    onChoose({ tags, match: "any" });
  };
  const wanted = typed.trim();
  // Chosen tags first (they may not be among the suggestions), then the rest in their order.
  const chips = useMemo(() => {
    const offered = wanted ? suggestions.filter((tag) => tag.label.toLowerCase().includes(wanted.toLowerCase())) : suggestions;
    const extra = chosen.tags.filter((tag) => !suggestions.some((item) => same(item.label, tag))).map((tag): Suggestion => ({ label: tag }));
    return [...extra, ...offered.filter((tag) => isChosen(tag.label)), ...offered.filter((tag) => !isChosen(tag.label))];
  }, [suggestions, chosen.tags, wanted]);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!wanted) return;
    const known = suggestions.find((tag) => same(tag.label, wanted))?.label ?? wanted;
    if (!isChosen(known)) toggle(known);
    setTyped("");
  };
  const chipClass = (on: boolean) => `${styles.menuChip} ${on ? styles.menuChipOn : ""}`;
  return (
    <div className={styles.menuSection}>
      <div className={styles.menuHeader}>
        <h3 className={styles.menuTitle}>Tags</h3>
        <form onSubmit={submit} className={styles.menuFind}>
          <input type="search" className={styles.menuFindInput} value={typed} maxLength={80} placeholder="Search tags..." aria-label="Find a tag" onChange={(event) => setTyped(event.target.value)} />
        </form>
        <span className={styles.menuSpacer} />
        {chosen.tags.length > 0 ? (
          <button type="button" className={styles.menuClear} onClick={() => onChoose({ tags: [], match: "any" })}>Clear All</button>
        ) : null}
      </div>
      {chips.length > 0 || wanted ? (
        <div className={styles.menuChips} role="group" aria-label="Tags to look for">
          {chips.map((tag) => (
            <button key={tag.label.toLowerCase()} type="button" className={chipClass(isChosen(tag.label))} aria-pressed={isChosen(tag.label)} title={tag.label} onClick={() => toggle(tag.label)}>
              <span className={styles.chipName}>{tag.label}</span>
              {tag.songs ? <span className={styles.chipCount}>{tag.songs.toLocaleString()}</span> : null}
            </button>
          ))}
          {wanted && !chips.some((tag) => same(tag.label, wanted)) ? (
            <button type="button" className={chipClass(false)} onClick={() => { toggle(wanted); setTyped(""); }}>
              <span className={styles.chipName}>Look for “{wanted}”</span>
            </button>
          ) : null}
        </div>
      ) : <p className={styles.hint}>No tags to choose from yet.</p>}
    </div>
  );
}
