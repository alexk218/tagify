import "fake-indexeddb/auto";
import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "../app";

afterEach(() => { vi.unstubAllGlobals(); });

it("starts an unlinked library without account setup and keeps connecting optional after a restart", async () => {
  vi.stubGlobal("IntersectionObserver", vi.fn(() => ({
    observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn(),
  })));
  vi.stubGlobal("Spicetify", {
    ...Spicetify,
    Platform: {
      ...Spicetify.Platform,
      AuthorizationAPI: { getState: () => ({ token: { accessToken: "isolated-first-run-token" } }) },
      UserAPI: { getUser: async () => ({ username: "first-run-listener" }) },
    },
  });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(
    url.includes("/updates") ? { schemaVersion: 1, releases: [] } : { tag_name: "v3.0.0" },
  ), { headers: { "Content-Type": "application/json" } })));
  sessionStorage.clear();

  const firstVisit = render(<App />);
  // A real fresh install completes IndexedDB setup before editing tools appear.
  await waitFor(() => expect(screen.queryByText("Loading tag data...")).not.toBeInTheDocument(), { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "Automatic tags" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Last saved:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("group", { name: "Song edit history" })).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Community setup" })).not.toBeInTheDocument();
  // Connecting is suggested inline, but setup opens only when the listener chooses it.
  const invitation = await screen.findByRole("region", { name: "Share your tags on Community" }, { timeout: 5000 });
  expect(screen.queryByRole("dialog", { name: "Community setup" })).not.toBeInTheDocument();
  fireEvent.click(within(invitation).getByRole("button", { name: "Share my tags" }));
  expect(screen.getByRole("dialog", { name: "Community setup" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Share your tags on Community" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

  fireEvent.click(screen.getByRole("button", { name: "Open the Tagify Community workspace" }));
  expect(screen.queryByRole("region", { name: "Share your tags on Community" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Share my tags" }));
  expect(screen.getByRole("dialog", { name: "Community setup" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: "Community setup" })).not.toBeInTheDocument();

  firstVisit.unmount();
  sessionStorage.clear();
  render(<App />);
  await waitFor(() => expect(screen.queryByText("Loading tag data...")).not.toBeInTheDocument(), { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "Automatic tags" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Last saved:/)).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Community setup" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Tracks" })).toHaveAttribute("aria-selected", "true");
});
