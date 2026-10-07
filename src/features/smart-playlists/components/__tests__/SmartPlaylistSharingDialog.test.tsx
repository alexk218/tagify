import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import SmartPlaylistSharingDialog from "../SmartPlaylistSharingDialog";
import { CREATE_SHARED_TAG } from "../../utils/smartPlaylist.recipes";
import type { SmartPlaylistCriteria, SmartPlaylistRecipeBundle } from "../../model/smartPlaylist.types";

const taxonomy = buildTaxonomyFromCategoryTree([{ id: "my-genres", name: "My music", subcategories: [{ id: "dance", name: "Dance", tags: [{ id: "house", name: "House" }] }] }]);
const tagId = Object.keys(taxonomy.tagsById)[0];
const criteria = { includeTagClauses: [{ tagIds: ["house"], excludedTagIds: [], operator: "AND" as const }], clauseConnectors: [], ratingFilters: [5], energyMinFilter: null, energyMaxFilter: null, bpmMinFilter: null, bpmMaxFilter: null };
const bundle: SmartPlaylistRecipeBundle = { format: "tagify-smart-playlist-recipes", version: 1, exportedAt: "2026-10-07", recipes: [{ id: "house-share", name: "Night House", criteria, tagReferences: [{ key: "house", name: "House", categoryName: "Genre", folderPath: ["Electronic"] }] }] };
const setup: SmartPlaylistCriteria = { id: "mine", playlistId: "", playlistName: "Night House", criteria: { ...criteria, includeTagClauses: [{ ...criteria.includeTagClauses[0], tagIds: [tagId] }] }, createdAt: 1, isActive: false, lastSyncAt: 0, smartPlaylistTrackUris: [], source: { recipeId: "house-share", revision: 1 } };
const tracks = { "spotify:track:mine": { name: "Night Drive", artists: "Maya Fields", rating: 5, energy: 4, bpm: null, tagIds: [tagId], dateModified: 12 }, "spotify:local:Artist:Album:Track:100": { name: "Local song", rating: 5, energy: 4, bpm: null, tagIds: [tagId], dateModified: 13 } };
const summary = { importedCount: 1, relinkedCount: 0, unresolvedCount: 0, verificationUnavailable: false };
function show(overrides: Partial<React.ComponentProps<typeof SmartPlaylistSharingDialog>> = {}) {
  const props = { mode: "import" as const, bundle, taxonomy, playlists: [], tracks, onShare: vi.fn(), onImport: vi.fn().mockResolvedValue(summary), onClose: vi.fn(), ...overrides };
  render(<SmartPlaylistSharingDialog {...props} />); return props;
}

describe("sharing from the user’s perspective", () => {
  it("requires tag matching, previews the recipient’s songs, and saves only after confirmation", async () => {
    const user = userEvent.setup(); const props = show();
    expect(screen.getByRole("button", { name: "Add 1 setup" })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText("Your tag for House in Night House"), tagId);
    expect(screen.getByText("1 Spotify song matches")).toBeInTheDocument();
    expect(screen.getByText(/1 local song also match/)).toBeInTheDocument();
    await user.click(screen.getByText("Preview matching songs"));
    expect(screen.getByText("Night Drive — Maya Fields")).toBeInTheDocument();
    expect(props.onImport).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Add 1 setup" }));
    expect(props.onImport).toHaveBeenCalledWith(bundle, [expect.objectContaining({ mode: "add", tagMappings: { house: tagId } })]);
    expect(await screen.findByText("Your setups are saved")).toBeInTheDocument();
    expect(screen.getByText(/Your new setups are inactive/)).toBeInTheDocument();
  });
  it("explains why creating a missing tag yields an empty playlist and lets users save for later", async () => {
    const user = userEvent.setup(); show();
    await user.selectOptions(screen.getByLabelText("Your tag for House in Night House"), CREATE_SHARED_TAG);
    expect(screen.getByText("0 Spotify songs match")).toBeInTheDocument();
    expect(screen.getByText(/This creates an empty tag/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add 1 setup" })).toBeEnabled();
  });
  it("keeps previously imported rules by default and offers only an independent copy", async () => {
    const user = userEvent.setup(); const props = show({ playlists: [{ ...setup, playlistId: "existing", isActive: true }] });
    const checkbox = screen.getByRole("checkbox", { name: "Add a separate copy of Night House" });
    expect(checkbox).not.toBeChecked(); expect(screen.getByRole("button", { name: "Add 0 setups" })).toBeDisabled();
    await user.click(checkbox);
    await user.selectOptions(screen.getByLabelText("Your tag for House in Night House"), tagId);
    await user.click(screen.getByRole("button", { name: "Add 1 setup" }));
    expect(props.onImport).toHaveBeenCalledWith(bundle, [expect.objectContaining({ mode: "copy" })]);
  });
  it("cancels without adding tags, setups, or Spotify connections", async () => {
    const user = userEvent.setup(); const props = show();
    await user.selectOptions(screen.getByLabelText("Your tag for House in Night House"), CREATE_SHARED_TAG);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onClose).toHaveBeenCalledOnce(); expect(props.onImport).not.toHaveBeenCalled();
  });
  it("shows failures in the review and permits retry without double submission", async () => {
    const user = userEvent.setup(); let finish!: (value: typeof summary) => void;
    const onImport = vi.fn().mockRejectedValueOnce(new Error("quota")).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    show({ onImport }); await user.selectOptions(screen.getByLabelText("Your tag for House in Night House"), tagId);
    await user.click(screen.getByRole("button", { name: "Add 1 setup" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your existing playlists are unchanged");
    await user.click(screen.getByRole("button", { name: "Add 1 setup" }));
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish(summary); await screen.findByText("Your setups are saved"); expect(onImport).toHaveBeenCalledTimes(2);
  });
  it("shares only selected setups and explains what the file contains and how to use it", async () => {
    const user = userEvent.setup(); const other = { ...setup, id: "other", playlistName: "Other mix" }; const props = show({ mode: "share", playlists: [setup, other] });
    await user.click(screen.getByRole("checkbox", { name: /Other mix/ }));
    await user.click(screen.getByRole("button", { name: "Save share file" }));
    expect(props.onShare).toHaveBeenCalledWith([setup]);
    expect(await screen.findByText("Your share is ready")).toBeInTheDocument();
    expect(screen.getByText(/They open Smart Playlists in Tagify and choose Import/)).toBeInTheDocument();
  });
  it("requires a creation review and explains ongoing sync before touching Spotify", async () => {
    const user = userEvent.setup(); const onCreate = vi.fn().mockResolvedValue(undefined); show({ mode: "create", setup, onCreate });
    expect(screen.getByText(/Creates a new private playlist/)).toBeInTheDocument();
    expect(screen.getByText(/songs that stop matching are removed/)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create playlist and enable sync" })); expect(onCreate).toHaveBeenCalledWith(setup);
  });
  it("dismisses with Escape and keeps tag selections when searching", async () => {
    const user = userEvent.setup(); const props = show();
    await user.selectOptions(screen.getByLabelText("Your tag for House in Night House"), tagId);
    await user.type(screen.getByPlaceholderText("Search tag names or folders"), "no matches");
    expect(screen.getByLabelText("Your tag for House in Night House")).toHaveValue(tagId);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); expect(props.onClose).toHaveBeenCalledOnce();
  });
  it("blocks importing an empty setup name", async () => {
    const user = userEvent.setup(); show();
    await user.selectOptions(screen.getByLabelText("Your tag for House in Night House"), tagId);
    await user.clear(screen.getByLabelText("Setup name"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Add 1 setup" })).toBeDisabled());
  });
});
