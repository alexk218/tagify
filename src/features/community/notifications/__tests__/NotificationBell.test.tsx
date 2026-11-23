import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "../NotificationBell";
import { fetchNotifications, notificationUrl, unreadLabel, type CommunityNotification } from "../communityNotifications";
import { openCommunityUrlSignedIn } from "../../communityWebsiteLink";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/services/sync/SyncRuntime", () => ({ syncRuntime: { communityRequest: request } }));
vi.mock("../../communityWebsiteLink", () => ({ openCommunityUrlSignedIn: vi.fn(async () => undefined) }));

const SONG = "6a1f0c3e-2b4d-4e8f-9a01-3c5d7e9f1b20";
const entry = (id: number, read: boolean, text = `Entry ${id}`): CommunityNotification => ({
  id, kind: "follow", text, createdAt: new Date(Date.now() - 5 * 60_000).toISOString(), read, open: { screen: "profile", handle: "mira" },
});

describe("notificationUrl", () => {
  it("opens each entry's page on tagify.fm", () => {
    expect(notificationUrl({ screen: "profile", handle: "mira" })).toBe("https://tagify.fm/@mira");
    expect(notificationUrl({ screen: "song", catalogEntityId: SONG.toUpperCase() })).toBe(`https://tagify.fm/recording/${SONG}`);
    expect(notificationUrl({ screen: "tag", slug: "late-night" })).toBe("https://tagify.fm/tags/late-night");
    expect(notificationUrl({ screen: "website", path: "/discussion/42?from=bell" })).toBe("https://tagify.fm/discussion/42?from=bell");
  });

  it("opens the home page for anything unexpected, never another site", () => {
    expect(notificationUrl({ screen: "website", path: "//evil.example" })).toBe("https://tagify.fm/");
    expect(notificationUrl({ screen: "profile", handle: "../admin" })).toBe("https://tagify.fm/");
    expect(notificationUrl({ screen: "tag", slug: "Late Night" })).toBe("https://tagify.fm/");
    expect(notificationUrl(null)).toBe("https://tagify.fm/");
  });

  it("caps the count at 9+", () => {
    expect(unreadLabel(3)).toBe("3");
    expect(unreadLabel(10)).toBe("9+");
  });

  it("drops malformed entries and reads the next page from the cursor", async () => {
    const valid = entry(2, false);
    const answer = vi.fn().mockResolvedValue({ items: [valid, { id: "x" }], nextCursor: 2, unread: 1 });
    await expect(fetchNotifications(40, answer)).resolves.toEqual({ items: [valid], nextCursor: 2, unread: 1 });
    expect(answer).toHaveBeenCalledWith("/api/v2/device/notifications?before=40");
  });
});

describe("NotificationBell", () => {
  beforeEach(() => {
    request.mockReset();
    vi.mocked(openCommunityUrlSignedIn).mockClear();
    localStorage.clear();
  });

  it("stays hidden while Community doesn't serve the list", async () => {
    request.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    const { container } = render(<NotificationBell />);
    await waitFor(() => expect(request).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the unread count, marks shown entries read and opens an entry's page", async () => {
    request.mockImplementation(async (_path: string, options?: { method?: string }) =>
      options?.method === "PATCH" ? { saved: true, unread: 0 } : { items: [entry(2, false, "Mira followed you."), entry(1, true)], nextCursor: null, unread: 1 });
    render(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: "Notifications, 1 new" });
    expect(bell).toHaveTextContent("1");

    await act(async () => { fireEvent.click(bell); });
    expect(await screen.findByText("Mira followed you.")).toBeInTheDocument();
    expect(screen.getAllByText("5 min ago")).toHaveLength(2);
    await waitFor(() => expect(request).toHaveBeenCalledWith("/api/v2/device/notifications", { method: "PATCH", body: { ids: [2], via: "list" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument());

    fireEvent.click(screen.getByText("Mira followed you."));
    expect(openCommunityUrlSignedIn).toHaveBeenCalledWith("https://tagify.fm/@mira");
    expect(screen.queryByText("Mira followed you.")).not.toBeInTheDocument();
  });

  it("says so when there is nothing yet, and closes on Escape", async () => {
    request.mockResolvedValue({ items: [], nextCursor: null, unread: 0 });
    render(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: "Notifications" });
    await act(async () => { fireEvent.click(bell); });
    expect(await screen.findByText("No notifications yet.")).toBeInTheDocument();
    fireEvent.keyDown(bell, { key: "Escape" });
    expect(screen.queryByText("No notifications yet.")).not.toBeInTheDocument();
  });

  it("explains a failed load in plain words", async () => {
    request.mockResolvedValueOnce({ items: [], nextCursor: null, unread: 0 }).mockRejectedValueOnce(new Error("503"));
    render(<NotificationBell />);
    const bell = await screen.findByRole("button", { name: "Notifications" });
    await act(async () => { fireEvent.click(bell); });
    expect(await screen.findByRole("alert")).toHaveTextContent("Notifications aren't loading right now. Try again in a moment.");
  });
});
