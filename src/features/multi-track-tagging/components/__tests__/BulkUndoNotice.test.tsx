import React from "react";
import { expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BulkUndoNotice } from "../BulkUndoNotice";
const { getBulkEditHistory } = vi.hoisted(() => ({ getBulkEditHistory: vi.fn() }));
vi.mock("@/services/storage/IndexedDBStorageService", () => ({ indexedDBStorage: { getBulkEditHistory } }));
beforeEach(() => getBulkEditHistory.mockReset());
it("keeps paired icon controls visible and explains unavailable actions", async () => {
  getBulkEditHistory.mockResolvedValue({ undo: null, redo: null });
  render(<BulkUndoNotice onUndo={vi.fn()} onRedo={vi.fn()} />);
  await waitFor(() => expect(getBulkEditHistory).toHaveBeenCalled());
  expect(screen.getByRole("button", { name: "Undo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Redo" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute("title", "No changes to undo");
  expect(screen.queryByText("Last bulk change")).not.toBeInTheDocument();
});
it("switches from Undo to Redo and reports preserved later edits", async () => {
  getBulkEditHistory.mockResolvedValueOnce({ undo: { id: "last", changes: { one: {}, two: {} } }, redo: null }).mockResolvedValue({ undo: null, redo: { id: "redo", changes: { one: {} } } });
  const onUndo = vi.fn().mockResolvedValue({ restoredTracks: 1, skippedFields: 1 });
  const onRedo = vi.fn().mockResolvedValue({ restoredTracks: 1, skippedFields: 0 });
  render(<BulkUndoNotice onUndo={onUndo} onRedo={onRedo} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(onUndo).toHaveBeenCalledWith("last");
  expect(screen.getByRole("status")).toHaveTextContent("Kept values edited since that change");
  await userEvent.click(screen.getByRole("button", { name: "Redo" }));
  expect(onRedo).toHaveBeenCalledWith("redo");
});
it("keeps a failed undo available for retry", async () => {
  getBulkEditHistory.mockResolvedValue({ undo: { id: "last", changes: { one: {} } }, redo: null });
  render(<BulkUndoNotice onUndo={vi.fn().mockRejectedValue(new Error("Please retry"))} onRedo={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByRole("status")).toHaveTextContent("Please retry");
  expect(screen.getByRole("button", { name: "Undo" })).toBeEnabled();
});
