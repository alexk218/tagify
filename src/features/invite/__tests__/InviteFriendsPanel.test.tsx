import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";
import { InviteFriendsPanel } from "../InviteFriendsPanel";
import { GENERAL_INVITE_PREVIEW, GENERAL_INVITE_URL, type InviteLink } from "../inviteLink";

vi.mock("@/features/product-analytics/productAnalytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/product-analytics/productAnalytics")>()),
  recordProductInteraction: vi.fn(),
}));

const personal: InviteLink = { kind: "personal", url: "https://community.tagify.fm/join/alex", preview: "https://community.tagify.fm/join/alex/opengraph-image" };
const general = (nameStep: "connect" | "publish" | null): InviteLink => ({ kind: "general", url: GENERAL_INVITE_URL, preview: GENERAL_INVITE_PREVIEW, nameStep });

function renderPanel(link: InviteLink, entry: "action_bar" | "milestone" = "action_bar") {
  const actions = { onConnectCommunity: vi.fn(), onOpenSync: vi.fn() };
  render(<InviteFriendsPanel entry={entry} resolveLink={() => Promise.resolve(link)} {...actions} />);
  return actions;
}

/** The link field once it shows the link, which is exactly what a hand copy picks up. */
async function findLinkField(url: string) {
  const field = screen.getByRole("textbox", { name: "Invite link" });
  await waitFor(() => expect(field.textContent).toBe(url));
  return field;
}

describe("InviteFriendsPanel", () => {
  const writeText = vi.fn();
  beforeEach(() => {
    vi.mocked(recordProductInteraction).mockClear();
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  });

  it("copies the member's personal invite and shows what their friend will see", async () => {
    renderPanel(personal);
    const field = await findLinkField(personal.url);
    expect(field).toHaveAttribute("aria-readonly", "true");
    expect(screen.getByRole("img", { name: "Your invite, with your name and your tags" })).toHaveAttribute("src", personal.preview);
    expect(screen.getByText("What they'll see")).toBeInTheDocument();
    expect(screen.queryByText(/Want your name on the invite/)).not.toBeInTheDocument();
    expect(recordProductInteraction).toHaveBeenCalledWith("invite_opened", { invite_entry: "action_bar", invite_link: "personal" });

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(personal.url);
    expect(screen.getByRole("status")).toHaveTextContent("Invite link copied");
    expect(recordProductInteraction).toHaveBeenCalledWith("invite_link_copied", { invite_entry: "action_bar", invite_link: "personal" });
  });

  it("offers Community setup to put the member's name on the invite", async () => {
    const actions = renderPanel(general("connect"), "milestone");
    await findLinkField(GENERAL_INVITE_URL);
    expect(GENERAL_INVITE_URL).toBe("https://community.tagify.fm/join");
    expect(screen.getByRole("img", { name: "You're invited to Tagify" })).toHaveAttribute("src", "https://community.tagify.fm/join/opengraph-image");
    expect(recordProductInteraction).toHaveBeenCalledWith("invite_opened", { invite_entry: "milestone", invite_link: "general" });

    fireEvent.click(screen.getByRole("button", { name: "Connect Community" }));
    expect(actions.onConnectCommunity).toHaveBeenCalledOnce();
    expect(actions.onOpenSync).not.toHaveBeenCalled();
  });

  it("points a connected member with private tags to the Sync dialog", async () => {
    const actions = renderPanel(general("publish"));
    fireEvent.click(await screen.findByRole("button", { name: "Make your tags public" }));
    expect(actions.onOpenSync).toHaveBeenCalledOnce();
  });

  it("suggests nothing when Tagify couldn't tell whether the invite would carry a name", async () => {
    renderPanel(general(null));
    await findLinkField(GENERAL_INVITE_URL);
    expect(screen.queryByText(/Want your name on the invite/)).not.toBeInTheDocument();
  });

  it("shows a long handle whole, letting the link wrap only after a slash", async () => {
    const handle = "the_longest_handle_allowed_x30";
    const long: InviteLink = { kind: "personal", url: `https://community.tagify.fm/join/${handle}`, preview: `https://community.tagify.fm/join/${handle}/opengraph-image` };
    renderPanel(long);
    const field = await findLinkField(long.url);
    const wrapsAfter = [...field.querySelectorAll("wbr")].map((mark) => mark.previousSibling?.textContent);
    expect(wrapsAfter).toEqual(["https://", "community.tagify.fm/", "join/"]);
    expect(field.lastChild?.textContent).toBe(handle);
  });

  it("selects the whole link when the member focuses it", async () => {
    renderPanel(personal);
    const field = await findLinkField(personal.url);
    // jsdom collapses the selection after focus() itself, so dispatch the focus event alone.
    fireEvent.focusIn(field);
    expect(window.getSelection()?.toString()).toBe(personal.url);
  });

  it("explains a failed copy and selects the link so it can be copied by hand", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    renderPanel(personal);
    const field = await findLinkField(personal.url);
    window.getSelection()?.removeAllRanges();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy the link. Select it above and copy it yourself.");
    expect(field).toHaveFocus();
    expect(window.getSelection()?.toString()).toBe(personal.url);
    expect(recordProductInteraction).not.toHaveBeenCalledWith("invite_link_copied", expect.anything());
  });

  it("keeps the field and Copy link out of reach until the link arrives", () => {
    render(<InviteFriendsPanel entry="action_bar" resolveLink={() => new Promise(() => undefined)} onConnectCommunity={vi.fn()} onOpenSync={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Invite link" });
    expect(field).toHaveTextContent("Getting your link…");
    expect(field).toHaveAttribute("aria-disabled", "true");
    expect(field).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("button", { name: "Copy link" })).toBeDisabled();
  });

  it("leaves the preview out when it can't load", async () => {
    renderPanel(personal);
    fireEvent.error(await screen.findByRole("img"));
    await waitFor(() => expect(screen.queryByRole("img")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy link" })).toBeEnabled();
  });
});
