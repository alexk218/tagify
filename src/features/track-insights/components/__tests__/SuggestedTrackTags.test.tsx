import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { buildTaxonomyFromCategoryTree } from "@/utils/tagTaxonomy";
import type { AlbumTrackSummary } from "@/types/tagData";
import { SuggestedTrackTags } from "../SuggestedTrackTags";
const taxonomy = buildTaxonomyFromCategoryTree([{ id: "cat_genre", name: "Genre", subcategories: [
  { id: "sub_style", name: "Style", tags: [{ id: "tag_house", name: "House" }] },
] }]);
const summary: AlbumTrackSummary = { albumName: "Example", artistName: "Example", imageUrl: null, taggedTrackCount: 4, ratedTrackCount: 0, ratingAverage: null,
  energyTrackCount: 0, energyAverage: null, lastTaggedAt: 123,
  commonTags: [{ tagId: "tag_house", trackCount: 3, coverage: 0.75 }] };
for (const entityLabel of ["album", "artist", "playlist"] as const) {
  it(`offers only Add for ${entityLabel} suggestions and reflects saved choices`, async () => {
    const onAddTag = vi.fn();
    const props = { summary, taxonomy, entityLabel, onAddTag };
    const { rerender } = render(<SuggestedTrackTags {...props} />);
    const add = screen.getByRole("button", { name: `Add House to this ${entityLabel}` });
    add.focus();
    await userEvent.keyboard("{Enter}");
    expect(onAddTag).toHaveBeenCalledWith("tag_house");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    rerender(<SuggestedTrackTags {...props} appliedTagIds={["tag_house"]} />);
    expect(screen.getByRole("button", { name: `House added to this ${entityLabel}` })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: `House added to this ${entityLabel}` }));
    expect(screen.queryByRole("button", { name: /filter/i })).not.toBeInTheDocument();
    expect(onAddTag).toHaveBeenCalledTimes(1);
  });
}
it("explains partial artist suggestions and hides removed or absent tags", () => {
  const { rerender } = render(<SuggestedTrackTags summary={summary} taxonomy={taxonomy} entityLabel="artist" partial onAddTag={vi.fn()} />);
  expect(screen.getByText(/From your checked tracks/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add House to this artist" }).title).toContain("3 of 4 checked tracks");
  rerender(<SuggestedTrackTags summary={{ ...summary, commonTags: [{ tagId: "gone", trackCount: 3, coverage: 0.75 }] }} taxonomy={taxonomy} entityLabel="artist" onAddTag={vi.fn()} />);
  expect(screen.queryByLabelText("Suggested tags")).not.toBeInTheDocument();
});
