import { vi } from "vitest";
import type { PublicationPolicyV2 } from "@tagify/sync-contracts";
import type { TagTaxonomy, TrackData } from "@/types/tagData";
import { publicationState } from "../communityPublication";
import type { CommunitySharing } from "../useCommunitySharing";

export function policyFixture(overrides: Partial<PublicationPolicyV2> = {}): PublicationPolicyV2 {
  return {
    policyVersion: 2,
    revision: 1,
    reviewedAt: "2026-10-01T00:00:00.000Z",
    enabled: true,
    paused: false,
    shareTaxonomy: true,
    shareActivity: false,
    entities: {
      track: { tags: true, rating: false },
      album: { tags: true, rating: false },
      artist: { tags: true, rating: false },
    },
    hiddenTagIds: [],
    hiddenNodeIds: [],
    excludedEntities: [],
    entityOverrides: [],
    ...overrides,
  } as PublicationPolicyV2;
}

export function sharingStub(policy: PublicationPolicyV2 | null, overrides: Partial<CommunitySharing> = {}): CommunitySharing {
  return {
    phase: policy ? "ready" : "loading",
    policy,
    state: policy ? publicationState(policy) : null,
    handle: "alex",
    refresh: vi.fn(),
    ...overrides,
  };
}

/** Mood › Calm › Rain, Mood › Happy, and Workout, with three tagged songs and one local file. */
export function taxonomyFixture(): TagTaxonomy {
  return {
    categoryOrder: ["mood", "workout"],
    categoriesById: {
      mood: { id: "mood", name: "Mood", subcategoryIds: ["calm"], childIds: ["calm", "happy"] },
      workout: { id: "workout", name: "Workout", subcategoryIds: [], childIds: ["run"] },
    },
    foldersById: {
      calm: { id: "calm", name: "Calm", parentId: "mood", categoryId: "mood", tagIds: ["rain"], childIds: ["rain"] },
    },
    subcategoriesById: {
      calm: { id: "calm", name: "Calm", parentId: "mood", categoryId: "mood", tagIds: ["rain"], childIds: ["rain"] },
    },
    childrenByParentId: { mood: ["calm", "happy"], calm: ["rain"], workout: ["run"] },
    tagsById: {
      rain: { id: "rain", name: "Rain", parentId: "calm", subcategoryId: "calm" },
      happy: { id: "happy", name: "Happy", parentId: "mood" },
      run: { id: "run", name: "Run", parentId: "workout" },
    },
    customAccentsById: {},
    colorThemesById: {},
    colorThemeOrder: [],
    ungroupedColorIds: [],
  } as unknown as TagTaxonomy;
}

export function tracksFixture(): Record<string, TrackData> {
  const track = (tagIds: string[]) => ({ rating: 0, energy: 0, bpm: null, tagIds }) as TrackData;
  return {
    "spotify:track:one": track(["rain", "happy"]),
    "spotify:track:two": track(["run"]),
    "spotify:track:three": track(["happy"]),
    "spotify:local:Artist:Album:Song:180": track(["rain"]),
  };
}
