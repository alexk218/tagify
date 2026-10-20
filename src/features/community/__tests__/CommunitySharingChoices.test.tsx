import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TagTaxonomy } from "@/types/tagData";
import { CommunitySharingChoices, type SharingChoices } from "../CommunitySharingChoices";
// eslint-disable-next-line css-modules/no-unused-class -- the test checks one shared class
import styles from "../CloudSyncModal.module.css";
import { taxonomyFixture } from "./sharingFixtures";

function Choices({ initial = { hiddenTagIds: [], hiddenNodeIds: [] }, published = false, taxonomy = taxonomyFixture() }: { initial?: SharingChoices; published?: boolean; taxonomy?: TagTaxonomy }) {
  const [choices, setChoices] = useState(initial);
  return <>
    <CommunitySharingChoices taxonomy={taxonomy} choices={choices} published={published} onChange={setChoices} />
    <output data-testid="choices">{JSON.stringify(choices)}</output>
  </>;
}

const saved = () => JSON.parse(screen.getByTestId("choices").textContent || "{}") as SharingChoices;

describe("CommunitySharingChoices", () => {
  it("leaves every box unchecked while nothing is hidden and says tags will be public before publishing", () => {
    render(<Choices />);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));

    expect(screen.getByText("Check a tag or folder to hide it from your profile.")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Choose which tags are hidden" })).toHaveAttribute("tabindex", "0");
    const mood = screen.getByRole("checkbox", { name: "Hide Mood from your profile" });
    expect(mood).not.toBeChecked();
    expect(mood).toHaveClass(styles.visibilityCheckbox);
    expect(screen.getByText("All 2 will be public")).toBeInTheDocument();
    expect(screen.getAllByText("Will be public")).toHaveLength(3);
    expect(screen.queryByText(/Exclude|Excluded/)).not.toBeInTheDocument();
  });

  it("hides a whole folder and everything in it when checked, then shows it again", () => {
    render(<Choices published />);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getAllByText("Public")).toHaveLength(3);

    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Mood from your profile" }));
    expect(saved()).toEqual({ hiddenTagIds: [], hiddenNodeIds: ["mood"] });
    expect(screen.getByRole("checkbox", { name: "Hide Mood from your profile" })).toBeChecked();
    expect(screen.getByText("All 2 hidden")).toBeInTheDocument();
    expect(screen.getAllByText("Hidden with its folder")).toHaveLength(3);
    expect(screen.getByRole("checkbox", { name: "Hide Happy from your profile" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Mood from your profile" }));
    expect(saved()).toEqual({ hiddenTagIds: [], hiddenNodeIds: [] });
  });

  it("marks a folder as partly hidden when one of its tags is checked", () => {
    render(<Choices published />);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Hide Happy from your profile" }));

    expect(saved()).toEqual({ hiddenTagIds: ["happy"], hiddenNodeIds: [] });
    expect(screen.getByRole("checkbox", { name: "Hide Happy from your profile" })).toBeChecked();
    const mood = screen.getByRole("checkbox", { name: "Hide Mood from your profile" }) as HTMLInputElement;
    expect(mood.checked).toBe(false);
    expect(mood.indeterminate).toBe(true);
    expect(screen.getByText("1 of 2 hidden")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
  });

  it("finds tags inside folded folders and says when nothing matches", () => {
    render(<Choices />);
    expect(screen.queryByText("Rain")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search tags and folders" }), { target: { value: "rai" } });
    expect(screen.getByText("Rain")).toBeInTheDocument();
    expect(screen.queryByText("Workout")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search tags and folders" }), { target: { value: "jazz" } });
    expect(screen.getByText("No tags match this search.")).toBeInTheDocument();
  });

  it("says so when there are no tags to choose from", () => {
    render(<Choices taxonomy={{ ...taxonomyFixture(), categoryOrder: [], categoriesById: {}, tagsById: {}, childrenByParentId: {}, foldersById: {}, subcategoriesById: {} } as unknown as TagTaxonomy} />);
    expect(screen.getByText("You don't have any tags yet.")).toBeInTheDocument();
  });
});
