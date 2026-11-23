import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildMoodsStarterTaxonomy } from "@/constants/defaultTagData";
import { tastePackChoices } from "@/utils/tastePackTaxonomy";
import { TasteQuestion } from "../TasteQuestion";

const choices = tastePackChoices(buildMoodsStarterTaxonomy());

describe("TasteQuestion", () => {
  it("tick music types, see their tags, Continue", async () => {
    const onAnswer = vi.fn(async () => {});
    render(<TasteQuestion choices={choices} onAnswer={onAnswer} />);
    expect(screen.getByRole("heading", { name: "What do you listen to?" })).toBeInTheDocument();
    expect(screen.getByText("Pick a few and we'll set up tags that fit. Nothing's final, you can change them anytime.")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox")).toHaveLength(11);
    const next = screen.getByRole("button", { name: "Continue" });
    expect(next).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Metal & Heavy" }));
    expect(screen.getByText("These 11 tags go into Genre & Style:")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Tags these add" }).children).toHaveLength(11);
    fireEvent.click(next);
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(["metal"]));
  });

  it("Skip answers with no packs", async () => {
    const onAnswer = vi.fn(async () => {});
    render(<TasteQuestion choices={choices} onAnswer={onAnswer} />);
    expect(screen.getByRole("dialog", { name: "What do you listen to?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith([]));
  });

  it("a failed save says so and can be tried again", async () => {
    const onAnswer = vi.fn(async () => { throw new Error("offline"); });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(<TasteQuestion choices={choices} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Pop" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your tags couldn't be added. Try again in a moment.");
    expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
  });
});
