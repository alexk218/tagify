import React, { useContext, useEffect, useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OthersHome, type ChosenTags, type OthersHomeView } from "../OthersHome";
import { OthersHomeContext, type TagNameCount } from "../othersHomeContext";
import { recordProductInteraction } from "@/features/product-analytics/productAnalytics";

vi.mock("@/features/product-analytics/productAnalytics", () => ({ recordProductInteraction: vi.fn() }));

vi.mock("../../tagSearch/CommunityTagResults", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../tagSearch/CommunityTagResults")>()),
  CommunityTagSearch: ({ tags, match, emptyText }: { tags: readonly string[]; match: string; emptyText?: string }) => <p data-testid="results">{tags.join(" | ")} ({match}) {emptyText}</p>,
}));

const TAGS = ["Funky", "Late night", "Driving", "Warm-up", "Peak time", "Melodic", "Vocal", "Groovy", "Deep House", "Sunrise", "Focus"];
const tagSearch = { viewer: "me", onConnect: vi.fn(), onShare: vi.fn(), onPlay: vi.fn() };

const THEIR_NAMES: TagNameCount[] = [{ label: "Electronic", songs: 52 }, { label: "Late night", songs: 50 }, { label: "Chill", songs: 47 }];

/** Stands in for the "Your songs" list: reports what it found and shows the tags chosen for it. */
function YourSongs({ found }: { found: number }) {
  const reports = useContext(OthersHomeContext);
  useEffect(() => { reports.onFound?.(found); }, [reports, found]);
  useEffect(() => { reports.onTagNames?.(THEIR_NAMES); }, [reports]);
  return <><input aria-label="Search your songs" /><p data-testid="your-songs-tags">{reports.tags?.chosen.tags.join(" | ") || "none"}</p></>;
}

function Home({ start = "yours", search = true, found = 630, ownTags = TAGS, tags = [] as string[] }: { start?: OthersHomeView; search?: boolean; found?: number; ownTags?: string[]; tags?: string[] }) {
  const [view, setView] = useState<OthersHomeView>(start);
  const [chosen, setChosen] = useState<ChosenTags>({ tags, match: "any" });
  return <OthersHome yourSongs={<YourSongs found={found} />} tagSearch={search ? tagSearch : undefined} ownTags={ownTags} view={view} onView={setView} chosen={chosen} onChoose={setChosen} />;
}

const chips = () => within(screen.getByRole("group", { name: "Tags to look for" })).getAllByRole("button").map((chip) => chip.textContent);
/** Opens the Filters menu, whatever it shows on its badge. */
const openFilters = () => fireEvent.click(screen.getByRole("button", { name: /^Filters/, expanded: false }));

describe("Tagged by others: Your songs | New to you", () => {
  it("shows the member's songs first, with how many were found on the switch", () => {
    render(<Home />);
    expect(screen.getByRole("tab", { name: /^Your songs\s*630$/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "New to you" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("textbox", { name: "Search your songs" })).toBeVisible();
  });

  it("keeps the tags in the Filters menu, with how many are chosen on the button", () => {
    render(<Home start="new" tags={["Funky"]} />);
    expect(screen.queryByRole("group", { name: "Tags to look for" })).not.toBeInTheDocument();
    const filters = screen.getByRole("button", { name: "Filters 1" });
    fireEvent.click(filters);
    expect(filters).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(filters);
    expect(screen.queryByRole("group", { name: "Tags to look for" })).not.toBeInTheDocument();
  });

  it("Your songs: offers the names other members used on them, with how many songs each", () => {
    render(<Home />);
    openFilters();
    expect(chips()).toEqual(["Electronic52", "Late night50", "Chill47"]);
    fireEvent.click(screen.getByRole("button", { name: "Late night 50" }));
    expect(screen.getByTestId("your-songs-tags")).toHaveTextContent("Late night");
    expect(recordProductInteraction).toHaveBeenCalledWith("tagged_by_others_filter_used", { filter_kind: "tag" });
  });

  it("keeps the chosen tags on both lists, and Clear All takes them off both", () => {
    render(<Home tags={["Late night"]} />);
    expect(screen.getByTestId("your-songs-tags")).toHaveTextContent("Late night");
    openFilters();
    fireEvent.click(screen.getByRole("tab", { name: "New to you" }));
    expect(screen.getByRole("button", { name: "Late night" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("results")).toHaveTextContent("Late night (any)");
    fireEvent.click(screen.getByRole("tab", { name: /^Your songs/ }));
    expect(screen.getByRole("button", { name: "Late night 50" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    expect(screen.getByTestId("your-songs-tags")).toHaveTextContent("none");
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "New to you" }));
    expect(screen.queryByTestId("results")).not.toBeInTheDocument();
  });

  it("shows the chosen tags beside Filters while the menu is closed, each taken off with one click", () => {
    render(<Home start="new" tags={["Funky", "Driving"]} />);
    const pills = within(screen.getByRole("group", { name: "Chosen tags" }));
    expect(pills.getAllByRole("button").map((pill) => pill.textContent)).toEqual(["Funky×", "Driving×"]);
    fireEvent.click(pills.getByRole("button", { name: "Funky" }));
    expect(screen.getByTestId("results")).toHaveTextContent("Driving (any)");
    openFilters();
    expect(screen.queryByRole("group", { name: "Chosen tags" })).not.toBeInTheDocument();
  });

  it("puts Filters and the chosen tags on the switch's row, the switch centered", () => {
    const label = (part: Element) => part.getAttribute("aria-label") ?? part.textContent;
    const rowOf = () => screen.getByRole("tablist", { name: "Songs other members tagged" }).parentElement!;
    render(<Home tags={["Funky"]} />);
    expect(Array.from(rowOf().children).map((part) => part.getAttribute("aria-label") ?? Array.from(part.children).map(label).join("+"))).toEqual(["Filters1+Chosen tags", "Songs other members tagged", ""]);
  });

  it("Your songs: finds a name by part of it", () => {
    render(<Home />);
    openFilters();
    fireEvent.change(screen.getByRole("searchbox", { name: "Find a tag" }), { target: { value: "chi" } });
    expect(chips()).toEqual(["Chill47", "Look for “chi”"]);
  });

  it("leaves the count off while nothing was found, and has no switch without Community's tag search", () => {
    const { unmount } = render(<Home found={0} />);
    expect(screen.getByRole("tab", { name: "Your songs" })).toBeInTheDocument();
    unmount();
    render(<Home search={false} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Filters/ })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search your songs" })).toBeVisible();
  });

  it("keeps what was typed under Your songs while New to you is showing", () => {
    render(<Home />);
    fireEvent.change(screen.getByRole("textbox", { name: "Search your songs" }), { target: { value: "armstrong" } });
    fireEvent.click(screen.getByRole("tab", { name: "New to you" }));
    expect(screen.getByRole("textbox", { name: "Search your songs", hidden: true })).not.toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: /^Your songs/ }));
    expect(screen.getByRole("textbox", { name: "Search your songs" })).toHaveValue("armstrong");
  });

  it("New to you: asks for a tag first, offering every one of the member's tags, most used first", () => {
    render(<Home start="new" />);
    expect(screen.getByText(/^Choose a tag to see songs other members tagged that way/)).toBeVisible();
    expect(screen.queryByTestId("results")).not.toBeInTheDocument();
    openFilters();
    expect(chips()).toEqual(TAGS);
  });

  it("looks for the chosen tags, any of them, and stops when the last one is taken off", () => {
    render(<Home start="new" />);
    openFilters();
    fireEvent.click(screen.getByRole("button", { name: "Funky" }));
    expect(screen.getByRole("button", { name: "Funky" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("results")).toHaveTextContent("Funky (any) No songs tagged Funky by other members yet.");
    fireEvent.click(screen.getByRole("button", { name: "Driving" }));
    expect(screen.getByTestId("results")).toHaveTextContent("Funky | Driving (any) No songs tagged Funky or Driving by other members yet.");
    fireEvent.click(screen.getByRole("button", { name: "Funky" }));
    fireEvent.click(screen.getByRole("button", { name: "Driving" }));
    expect(screen.queryByTestId("results")).not.toBeInTheDocument();
  });

  it("finds a tag by typing, the member's own or any other name", () => {
    render(<Home start="new" />);
    openFilters();
    const find = screen.getByRole("searchbox", { name: "Find a tag" });
    fireEvent.change(find, { target: { value: "sun" } });
    expect(chips()).toEqual(["Sunrise", "Look for “sun”"]);
    fireEvent.change(find, { target: { value: "sunrise" } });
    expect(chips()).toEqual(["Sunrise"]);
    fireEvent.submit(find);
    expect(screen.getByTestId("results")).toHaveTextContent("Sunrise (any)");
    expect(find).toHaveValue("");

    fireEvent.change(find, { target: { value: "Shoegaze" } });
    fireEvent.click(screen.getByRole("button", { name: "Look for “Shoegaze”" }));
    expect(screen.getByTestId("results")).toHaveTextContent("Sunrise | Shoegaze (any)");
    // Chosen tags lead the chips, including one the member doesn't use.
    expect(chips().slice(0, 2)).toEqual(["Shoegaze", "Sunrise"]);
  });

  it("shows a tag name the member has in two groups as one chip", () => {
    render(<Home start="new" ownTags={["Funky", "Organic", "funky "]} tags={["Funky"]} />);
    openFilters();
    expect(chips()).toEqual(["Funky", "Organic"]);
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("starts with the tags the member came with", () => {
    render(<Home start="new" tags={["Funky"]} />);
    expect(screen.getByTestId("results")).toHaveTextContent("Funky (any)");
    openFilters();
    expect(screen.getByRole("button", { name: "Funky" })).toHaveAttribute("aria-pressed", "true");
  });
});
