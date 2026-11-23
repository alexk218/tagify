import React from "react";
import { createRoot } from "react-dom/client";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import { CommunityPublishPrompt } from "@/features/community/CommunityPublishPrompt";
import { CommunityRatingSharingQuestion } from "@/features/community/CommunityRatingSharingQuestion";
import { CommunityShareDialog } from "@/features/community/CommunityShareDialog";
import { CommunityUpdates } from "@/features/community-updates/CommunityUpdates";
import { communityUpdateService } from "@/features/community-updates/communityUpdateService";
import { syncRuntime } from "@/services/sync/SyncRuntime";
import type { TagTaxonomy, TrackData } from "@/types/tagData";

// ?view=question | publish-prompt | share-dialog | notice; ?sheet=narrow; ?save=paused makes saving fail.
const params = new URLSearchParams(location.search);
const view = params.get("view") || "question";
const width = params.get("sheet") === "narrow" ? 375 : 1100;
localStorage.clear();
Object.assign(window, { Spicetify: { Platform: { UserAPI: { getUser: async () => ({ username: "isolated-rating-sharing" }) } } } });
window.fetch = async () => new Response("{}", { status: 503 });

const policy = {
  policyVersion: 2, revision: 1, reviewedAt: null, enabled: false, paused: false, shareTaxonomy: true, shareActivity: false,
  entities: { track: { tags: true, rating: false }, album: { tags: true, rating: false }, artist: { tags: true, rating: false } },
  hiddenTagIds: [], hiddenNodeIds: [], excludedEntities: [], entityOverrides: [],
} as unknown as PublicationPolicyV2;
let ratingSharing = { available: true, shared: false, answered: false, profilePublic: true, rated: true, askOnDesktop: true };
Object.assign(syncRuntime, {
  communityRequest: async (path: string, options?: { body?: { share?: boolean } }) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (path === "/api/v2/rating-sharing") {
      if (options?.body) {
        if (params.get("save") === "paused") throw Object.assign(new Error("Ratings are paused right now. Try again later."), { status: 503 });
        ratingSharing = { ...ratingSharing, shared: Boolean(options.body.share), answered: true, askOnDesktop: false };
      }
      return { ratingSharing };
    }
    return { policy };
  },
  syncNow: async () => undefined,
});
communityUpdateService.check = async () => [{
  revision: 9, title: "Star ratings on Community", publishedAt: "2026-11-14T12:00:00Z", action: "share_ratings",
  changes: ["Rate songs and albums with stars on Community, in Tagify or on your phone.", "Your ratings can show on music you've tagged, so people see what you love most."],
}];

const taxonomy = {
  categoryOrder: ["mood"],
  categoriesById: { mood: { id: "mood", name: "Mood", subcategoryIds: [], childIds: ["happy", "calm"] } },
  foldersById: {}, subcategoriesById: {}, childrenByParentId: { mood: ["happy", "calm"] },
  tagsById: { happy: { id: "happy", name: "Happy", parentId: "mood" }, calm: { id: "calm", name: "Calm", parentId: "mood" } },
  customAccentsById: {}, colorThemesById: {}, colorThemeOrder: [], ungroupedColorIds: [],
} as unknown as TagTaxonomy;
const tracks = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`spotify:track:${index}`, { rating: 0, energy: 0, bpm: null, tagIds: index % 2 ? ["happy"] : ["happy", "calm"] } as TrackData]));

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ width, background: "#121212", border: "1px solid #333", padding: "8px 0 28px", minHeight: 160 }}>{children}</div>;
}

const sharing = { phase: "ready" as const, policy, state: "review" as const, handle: "alex", refresh: () => {} };

createRoot(document.getElementById("app")!).render(
  view === "question" ? <Frame><CommunityRatingSharingQuestion enabled connected status="idle" /></Frame>
  : view === "publish-prompt" ? <Frame><CommunityPublishPrompt enabled connected status="publication-review-required" taggedTrackCount={12} lastUserTrackAddedEvent={{ eventId: 1 } as never} tracks={tracks} taxonomy={taxonomy} onReview={() => {}} /></Frame>
  : view === "share-dialog" ? <CommunityShareDialog surface="invitation" sharing={sharing} tracks={tracks} taxonomy={taxonomy} onClose={() => {}} />
  : <CommunityUpdates enabled />,
);
