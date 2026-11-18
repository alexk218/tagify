import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sameTagNameKey, type PublicEntityViewV1 } from "@tagify/community-contracts";
import { TrackDetailsCommunity } from "../TrackDetailsCommunity";

const analytics = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: analytics.record,
}));
vi.mock("@/features/community/communityEntityCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/community/communityEntityCache")>()),
  peekCommunityEntity: () => undefined,
}));

const URI = "spotify:track:aaaaaaaaaaaaaaaaaaaaaa";
const tag = (label: string, path = label) => ({ label, path });
const entityWith = (contributors: unknown[]) =>
  ({ entity: { provider: "spotify", kind: "track", providerId: "aaaaaaaaaaaaaaaaaaaaaa" }, contributors }) as unknown as PublicEntityViewV1;
const members = [
  { handle: "nightdrive", displayName: "Night Drive", ratingHalfStars: 9, tags: [tag("Deep House", "Genre / Deep House"), tag("Warm")] },
  { handle: "maya.f", displayName: "Maya", ratingHalfStars: 8, tags: [tag("Deep House", "Genre / Deep House"), tag("Vocal")] },
  { handle: "me", displayName: "Me", isOwn: true, tags: [tag("Mine only")] },
];
const keys = (names: string[]) => new Set(names.map(sameTagNameKey));

function renderSection(contributors: unknown[], props: Partial<React.ComponentProps<typeof TrackDetailsCommunity>> = {}) {
  const lookup = vi.fn(async () => ({ found: true, entity: entityWith(contributors) }));
  const utils = render(
    <TrackDetailsCommunity uri={URI} songName="Glass Horizons" songTagKeys={keys(["Warm"])} libraryTagKeys={keys(["Warm", "Deep House"])}
      destinationOf={() => "Mood / Feel"} ownHandle="me" lookup={lookup} {...props} />,
  );
  return { ...utils, lookup };
}

afterEach(() => { vi.clearAllMocks(); });

describe("TrackDetailsCommunity", () => {
  it("renders nothing when no other member tagged or rated the song", async () => {
    const { container, lookup } = renderSection([members[2]]);
    await waitFor(() => expect(lookup).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("merges other members' tags, marks the ones already on the song and lists who tagged it", async () => {
    renderSection(members, { onAdd: vi.fn(async () => {}) });
    expect(await screen.findByRole("heading", { name: "From Community" })).toBeInTheDocument();
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Deep House to Glass Horizons" })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: "Warm is on Glass Horizons" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add Vocal to Glass Horizons" })).toHaveTextContent("new");
    expect(screen.queryByText("Mine only")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "@nightdrive" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rated 4.5 stars")).toBeInTheDocument();
  });

  it("adds a tag with one click and then shows it as on the song", async () => {
    const onAdd = vi.fn(async () => {});
    renderSection(members, { onAdd });
    await userEvent.click(await screen.findByRole("button", { name: "Add Deep House to Glass Horizons" }));
    expect(onAdd).toHaveBeenCalledWith([{ label: "Deep House", paths: ["Genre / Deep House"], people: 2 }]);
    expect(await screen.findByRole("button", { name: "Deep House is on Glass Horizons" })).toBeDisabled();
    expect(analytics.record).toHaveBeenCalledWith("track_list_members_tag_added", { members_add: "tag", new_to_library: "no" });
  });

  it("lets a tag be added again after it is removed from the song", async () => {
    const onAdd = vi.fn(async () => {});
    const { rerender, lookup } = renderSection(members, { onAdd });
    await userEvent.click(await screen.findByRole("button", { name: "Add Vocal to Glass Horizons" }));
    const props = { uri: URI, songName: "Glass Horizons", libraryTagKeys: keys(["Warm", "Deep House", "Vocal"]),
      destinationOf: () => "Mood / Feel", ownHandle: "me", lookup, onAdd };
    rerender(<TrackDetailsCommunity {...props} songTagKeys={keys(["Warm", "Vocal"])} />);
    expect(screen.getByRole("button", { name: "Vocal is on Glass Horizons" })).toBeDisabled();
    rerender(<TrackDetailsCommunity {...props} songTagKeys={keys(["Warm"])} />);
    expect(screen.getByRole("button", { name: "Add Vocal to Glass Horizons" })).toBeEnabled();
  });

  it("lets a tag be added again when the song already listed it before the add finished", async () => {
    let finish: () => void = () => {};
    const onAdd = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const { rerender, lookup } = renderSection(members, { onAdd });
    await userEvent.click(await screen.findByRole("button", { name: "Add Vocal to Glass Horizons" }));
    const props = { uri: URI, songName: "Glass Horizons", libraryTagKeys: keys(["Warm", "Deep House", "Vocal"]),
      destinationOf: () => "Mood / Feel", ownHandle: "me", lookup, onAdd };
    rerender(<TrackDetailsCommunity {...props} songTagKeys={keys(["Warm", "Vocal"])} />);
    await act(async () => { finish(); });
    rerender(<TrackDetailsCommunity {...props} songTagKeys={keys(["Warm"])} />);
    expect(screen.getByRole("button", { name: "Add Vocal to Glass Horizons" })).toBeEnabled();
  });

  it("keeps tags read-only without an add handler", async () => {
    renderSection(members);
    expect(await screen.findByRole("button", { name: "Add Vocal to Glass Horizons" })).toBeDisabled();
    expect(screen.queryByText("new")).not.toBeInTheDocument();
  });

  it("keeps tags read-only when not connected, even with an add handler, and asks to connect", async () => {
    const onAdd = vi.fn(async () => {});
    const onConnect = vi.fn();
    renderSection(members, { onAdd, onConnect });
    expect(await screen.findByRole("button", { name: "Add Vocal to Glass Horizons" })).toBeDisabled();
    expect(screen.getByText(/Connect to Tagify Community to add these tags/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "@nightdrive" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Connect" }));
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
  });
});
