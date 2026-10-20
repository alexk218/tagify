import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PowerUserModal from "../PowerUserModal";

describe("PowerUserModal", () => {
  beforeEach(() => localStorage.clear());

  it("asks for an invite first and shows the invite inside the celebration", async () => {
    const actions = { onClose: vi.fn(), onConnectCommunity: vi.fn(), onOpenSync: vi.fn() };
    render(<PowerUserModal taggedTrackCount={300} {...actions} />);
    const buttons = screen.getAllByRole("button").map((button) => button.textContent);
    expect(buttons).toEqual(["Invite a friend", "Star on GitHub", "Close"]);

    fireEvent.click(screen.getByRole("button", { name: "Invite a friend" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Invite link" })).toHaveTextContent("https://community.tagify.fm/join"));
    expect(screen.queryByRole("button", { name: "Star on GitHub" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Connect Community" }));
    expect(actions.onConnectCommunity).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Star on GitHub" })).toBeInTheDocument();
    expect(actions.onClose).not.toHaveBeenCalled();
  });
});
