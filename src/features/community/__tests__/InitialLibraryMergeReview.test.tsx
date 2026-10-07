import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { planInitialLibraryMerge, resolveInitialLibraryMerge, type InitialMergeSource, type LibrarySnapshotV2 } from "@tagify/sync-contracts";
import { InitialLibraryMergeReview } from "../InitialLibraryMergeReview";
import type { InitialMergeReview } from "@/services/sync/SyncRuntime";

const review: InitialMergeReview = {
  version: 1,
  supported: true,
  communityHeadCursor: 12,
  communityChecksum: null,
  device: { annotations: 1487, taxonomy: 80, smartPlaylists: 4, savedSettings: 9 },
  community: { annotations: 1461, taxonomy: 78, smartPlaylists: 3, savedSettings: 8 },
  additionsFromDevice: 26,
  additionsFromCommunity: 8,
  unchanged: 1400,
  conflicts: [{
    id: "annotation:spotify:track:same:field:rating",
    kind: "annotation-field",
    subjectId: "spotify:track:same",
    field: "rating",
    deviceValue: 4,
    communityValue: 5,
  }],
  labels: { "annotation:spotify:track:same:field:rating": "People" },
};

describe("InitialLibraryMergeReview", () => {
  it("uses the device version for differences while still keeping Community-only items", async () => {
    const node = (id: string, name: string) => ({ id, kind: "tag" as const, parentId: null, name, accentId: null, position: 0, nodeRevision: 1, parentListRevision: 1, deleted: false });
    const base: LibrarySnapshotV2 = {
      protocolVersion: 2, sourceStorageSchemaVersion: 9, libraryId: "44444444-4444-4444-8444-444444444444",
      headCursor: 0, generatedAt: "2026-09-26T00:00:00.000Z", taxonomy: [], colors: [], collections: [], annotations: [], appState: [],
    };
    const device = { ...base, taxonomy: [node("shared", "Device name")] };
    const community = { ...base, taxonomy: [node("shared", "Community name"), node("cloud-only", "Community-only tag")] };
    const plan = planInitialLibraryMerge(device, community);
    let merged: LibrarySnapshotV2 | null = null;
    const onCommit = vi.fn(async (resolutions: Record<string, InitialMergeSource>) => {
      merged = resolveInitialLibraryMerge(device, community, resolutions);
      return { version: 1 as const, headCursor: 1, additionsFromDevice: 0, additionsFromCommunity: 1, conflictsResolved: 1 };
    });
    render(<InitialLibraryMergeReview review={{ ...plan, supported: true, labels: { "taxonomy:shared": "Shared tag" } }} onCommit={onCommit} onDownloadBackup={vi.fn()} />);

    expect(screen.getByText(/1 from Community that will be added to this device, no matter which choice/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Use this device for differences" }));
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ "taxonomy:shared": "device" }));
    expect(merged!.taxonomy.map((item) => item.name)).toEqual(["Community-only tag", "Device name"]);
  });

  it("explains the merge in user language and requires an explicit default", () => {
    render(<InitialLibraryMergeReview review={review} onCommit={vi.fn()} onDownloadBackup={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Combine your Tagify libraries" })).toBeInTheDocument();
    expect(screen.getByText(/34 items found on only one side will be kept/i)).toBeInTheDocument();
    expect(screen.getByText(/8 from Community that will be added to this device, no matter which choice/i)).toBeInTheDocument();
    expect(screen.getByText(/This does not replace either whole library/i)).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Combine libraries" })).toBeDisabled();
    expect(screen.queryByText(/annotation|taxonomy|canonical/i)).not.toBeInTheDocument();
  });

  it("supports a bulk choice with an individual override", async () => {
    const onCommit = vi.fn().mockResolvedValue({ version: 1, headCursor: 13, additionsFromDevice: 26, additionsFromCommunity: 8, conflictsResolved: 1 });
    render(<InitialLibraryMergeReview review={review} onCommit={onCommit} onDownloadBackup={vi.fn()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Use Community for differences" }));
    fireEvent.click(screen.getByRole("button", { name: /This device 4/i }));
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({ "annotation:spotify:track:same:field:rating": "device" }));
    expect(await screen.findByText("Your Tagify libraries are combined.")).toBeInTheDocument();
  });

  it("replaces every individual choice when a bulk choice is pressed", async () => {
    const secondConflict = {
      ...review.conflicts[0],
      id: "annotation:spotify:track:other:field:rating",
      subjectId: "spotify:track:other",
      deviceValue: 2,
      communityValue: 3,
    };
    const twoConflictReview = {
      ...review,
      conflicts: [...review.conflicts, secondConflict],
      labels: { ...review.labels, [secondConflict.id]: "Other song" },
    };
    const onCommit = vi.fn().mockResolvedValue({ version: 1, headCursor: 13, additionsFromDevice: 26, additionsFromCommunity: 8, conflictsResolved: 2 });
    render(<InitialLibraryMergeReview review={twoConflictReview} onCommit={onCommit} onDownloadBackup={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /Community 5/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Use this device for differences" }));

    expect(screen.getByRole("button", { name: /This device 4/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /This device 2/i })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Combine libraries" }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith({
      "annotation:spotify:track:same:field:rating": "device",
      "annotation:spotify:track:other:field:rating": "device",
    }));
  });

  it("shows the structural field that makes matching tag names different", () => {
    const taxonomyConflict = {
      id: "taxonomy:vocals",
      kind: "taxonomy" as const,
      subjectId: "vocals",
      field: null,
      deviceValue: { kind: "tag", parentId: "sound", name: "Vocals", accentId: null, position: 1, deleted: false },
      communityValue: { kind: "tag", parentId: "sound", name: "Vocals", accentId: null, position: 4, deleted: false },
    };
    render(<InitialLibraryMergeReview
      review={{ ...review, conflicts: [taxonomyConflict], labels: { "taxonomy:vocals": "Vocals", "taxonomy-path:device:sound": "Sound", "taxonomy-path:community:sound": "Sound" } }}
      onCommit={vi.fn()}
      onDownloadBackup={vi.fn()}
    />);

    expect(screen.getByRole("button", { name: /This device Vocals · Position 2/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Community Vocals · Position 5/i })).toBeInTheDocument();
  });

  it("offers a safety backup without approving the merge", async () => {
    const onDownloadBackup = vi.fn().mockResolvedValue(undefined);
    const onCommit = vi.fn();
    render(<InitialLibraryMergeReview review={review} onCommit={onCommit} onDownloadBackup={onDownloadBackup} />);

    fireEvent.click(screen.getByRole("button", { name: "Download backup first" }));
    await waitFor(() => expect(onDownloadBackup).toHaveBeenCalledTimes(1));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("protects the library until Community supports reviewed merges", () => {
    render(<InitialLibraryMergeReview review={{ ...review, supported: false }} onCommit={vi.fn()} onDownloadBackup={vi.fn()} />);

    expect(screen.getByText(/Community is finishing an update/i)).toBeInTheDocument();
    expect(screen.getByText(/Your Tagify data has not changed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Combine libraries" })).toBeDisabled();
  });
});
