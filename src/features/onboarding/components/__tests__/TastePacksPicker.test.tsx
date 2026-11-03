import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { defaultTagData } from "@/constants/defaultTagData";
import { planTastePacksForTaxonomy, tastePackChoices } from "@/utils/tastePackTaxonomy";
import { TastePacksPicker, tastePacksAddedMessage } from "../TastePacksPicker";

const showNotification = vi.fn();
const choices = tastePackChoices(defaultTagData.taxonomy);
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as unknown as { Spicetify: unknown }).Spicetify = { showNotification };
});

it("offers the 11 packs, and adds the chosen ones in Tagify's order", async () => {
  const onAdd = vi.fn().mockResolvedValue(planTastePacksForTaxonomy(defaultTagData.taxonomy, ["pop", "metal"]).plan.packs);
  render(<TastePacksPicker choices={choices} onAdd={onAdd} onSkip={vi.fn()} />);

  expect(screen.getAllByRole("button", { pressed: false })).toHaveLength(11);
  expect(screen.getByRole("button", { name: "Metal & Heavy" })).toHaveAttribute("title", "Nu Metal, Hard Rock, Doom Metal, Metalcore… (11 new tags)");
  expect(screen.getByRole("button", { name: "Add packs" })).toBeDisabled();

  await userEvent.click(screen.getByRole("button", { name: /^Pop/ }));
  await userEvent.click(screen.getByRole("button", { name: /^Metal & Heavy/ }));
  expect(screen.getByRole("button", { name: /^Metal & Heavy/ })).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(screen.getByRole("button", { name: "Add 2 packs" }));

  expect(onAdd).toHaveBeenCalledWith(["metal", "pop"]);
  expect(showNotification).toHaveBeenCalledWith("Added 21 tags for Metal & Heavy and Pop to Genre & Style.");
});

it("can't add a pack whose tags are all there already", () => {
  const withMetal = tastePackChoices(planTastePacksForTaxonomy(defaultTagData.taxonomy, ["metal"]).taxonomy);
  render(<TastePacksPicker choices={withMetal} onAdd={vi.fn()} onSkip={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Metal & Heavy" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Metal & Heavy" })).toHaveAttribute("title", expect.stringContaining("(Already in your tags)"));
  expect(screen.getByRole("button", { name: "Rock & Punk" })).toHaveAttribute("title", expect.stringContaining("(11 new tags)"));
});

it("says so and lets the person try again when the tags couldn't be added", async () => {
  const onAdd = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValue([]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  render(<TastePacksPicker choices={choices} onAdd={onAdd} onSkip={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /^Hip-hop & Rap/ }));
  await userEvent.click(screen.getByRole("button", { name: "Add 1 pack" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Your tags couldn't be added. Try again in a moment.");
  expect(showNotification).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Add 1 pack" })).toBeEnabled();
});

it("skips without adding anything", async () => {
  const onAdd = vi.fn();
  const onSkip = vi.fn();
  render(<TastePacksPicker choices={choices} onAdd={onAdd} onSkip={onSkip} />);
  await userEvent.click(screen.getByRole("button", { name: "Skip" }));
  expect(onSkip).toHaveBeenCalledTimes(1);
  expect(onAdd).not.toHaveBeenCalled();
});

it("names one or two packs in the notification, and counts more", () => {
  const plan = (keys: string[]) => planTastePacksForTaxonomy(defaultTagData.taxonomy, keys).plan.packs;
  expect(tastePacksAddedMessage(choices, plan(["chill"]))).toBe("Added 8 tags for Chill & Lo-fi to Genre & Style.");
  expect(tastePacksAddedMessage(choices, plan(["chill", "jazz-soul", "country-folk"]))).toBe("Added 31 tags for 3 packs to Genre & Style.");
  expect(tastePacksAddedMessage(choices, [])).toBe("You already have these tags.");
});

it("in Tag Manager, shows packs already there as added and stays open after adding", async () => {
  const withMetal = planTastePacksForTaxonomy(defaultTagData.taxonomy, ["metal"]).taxonomy;
  const onAdd = vi.fn().mockResolvedValue(planTastePacksForTaxonomy(withMetal, ["pop"]).plan.packs);
  const onAdded = vi.fn();
  render(<TastePacksPicker choices={tastePackChoices(withMetal)} onAdd={onAdd} onAdded={onAdded} />);

  expect(screen.getByRole("button", { name: "Metal & Heavy Added" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Pop" }));
  await userEvent.click(screen.getByRole("button", { name: "Add 1 pack" }));

  expect(onAdded).toHaveBeenCalledWith("Added 10 tags for Pop to Genre & Style.");
  expect(showNotification).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Add packs" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Pop" })).toHaveAttribute("aria-pressed", "false");
});
