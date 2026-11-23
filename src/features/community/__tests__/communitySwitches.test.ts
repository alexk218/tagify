import { afterEach, describe, expect, it } from "vitest";
import { capabilitiesCacheKey } from "@/services/sync/SyncRuntime";
import { communitySwitchOn } from "../communitySwitches";
import { othersTagsWaitForSharing } from "../useCommunitySharing";

const BASE = "https://community.tagify.fm";
const offer = (value: Record<string, unknown>) => localStorage.setItem(capabilitiesCacheKey(BASE), JSON.stringify({ cachedAt: 1, value }));

afterEach(() => localStorage.clear());

describe("Community switches", () => {
  it("are on by default: not connected, no saved list, or a list that doesn't name them", () => {
    expect(communitySwitchOn("taggedByOthersTrackList", null)).toBe(true);
    expect(communitySwitchOn("taggedByOthersTrackList", BASE)).toBe(true);
    offer({ taggedByOthersLookup: { maxSongs: 500 }, othersTagsSharingGate: { enabled: "no" } });
    expect(communitySwitchOn("taggedByOthersTrackList", BASE)).toBe(true);
    expect(communitySwitchOn("othersTagsSharingGate", BASE)).toBe(true);
  });

  it("turn off when Community's list says so", () => {
    offer({ taggedByOthersTrackList: false, othersTagsSharingGate: { enabled: false } });
    expect(communitySwitchOn("taggedByOthersTrackList", BASE)).toBe(false);
    expect(communitySwitchOn("othersTagsSharingGate", BASE)).toBe(false);
  });

  it("follow this computer's own setting over Community's", () => {
    offer({ taggedByOthersTrackList: false });
    localStorage.setItem("tagify:switch:taggedByOthersTrackList", "on");
    expect(communitySwitchOn("taggedByOthersTrackList", BASE)).toBe(true);
    localStorage.setItem("tagify:switch:othersTagsSharingGate", "off");
    expect(communitySwitchOn("othersTagsSharingGate", null)).toBe(false);
  });
});

describe("Community tag search", () => {
  it("is on unless Community or this computer turns it off", () => {
    expect(communitySwitchOn("communityTagSearch", null)).toBe(true);
    expect(communitySwitchOn("communityTagSearch", BASE)).toBe(true);
    offer({ communityTagSearch: { enabled: false } });
    expect(communitySwitchOn("communityTagSearch", BASE)).toBe(false);
    localStorage.clear();
    localStorage.setItem("tagify:switch:communityTagSearch", "off");
    expect(communitySwitchOn("communityTagSearch", null)).toBe(false);
  });
});

describe("community teasers", () => {
  it("are on for a desktop that was never connected, since Community's preview route pauses them", () => {
    expect(communitySwitchOn("communityTeasers", null)).toBe(true);
    expect(communitySwitchOn("communityTeasers", BASE)).toBe(true);
    offer({ communityTeasers: { enabled: false } });
    expect(communitySwitchOn("communityTeasers", BASE)).toBe(false);
    localStorage.setItem("tagify:switch:communityTeasers", "on");
    expect(communitySwitchOn("communityTeasers", BASE)).toBe(true);
  });
});

describe("others' tags wait for the member to share theirs", () => {
  it("unlocks only while tags are actively shared: paused, private and not public yet all lock", () => {
    expect(othersTagsWaitForSharing(true, { phase: "ready", state: "public" })).toBe(false);
    expect(othersTagsWaitForSharing(true, { phase: "ready", state: "paused" })).toBe(true);
    expect(othersTagsWaitForSharing(true, { phase: "ready", state: "private" })).toBe(true);
    expect(othersTagsWaitForSharing(true, { phase: "ready", state: "review" })).toBe(true);
  });

  it("locks nothing while the choice is loading, unreadable, or the computer isn't connected", () => {
    expect(othersTagsWaitForSharing(true, { phase: "loading", state: null })).toBe(false);
    expect(othersTagsWaitForSharing(true, { phase: "error", state: null })).toBe(false);
    expect(othersTagsWaitForSharing(false, { phase: "ready", state: "private" })).toBe(false);
  });
});
