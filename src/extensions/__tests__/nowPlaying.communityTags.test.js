import { describe, expect, it } from "vitest";
import {
  createCommunityTagsChip,
  describeCommunityTags,
  summarizeCommunityTags,
} from "../nowPlaying.communityTags";

const contributor = (handle, labels, extra = {}) => ({
  handle,
  displayName: handle,
  ratingHalfStars: null,
  isFollowing: false,
  tags: labels.map((label) => ({ label, path: `Genre / ${label}` })),
  ...extra,
});

describe("summarizeCommunityTags", () => {
  it("counts each person once per tag name and lists the most used first", () => {
    const summary = summarizeCommunityTags({
      contributors: [
        contributor("ana", ["House", "Late night"]),
        contributor("ben", ["house", "Deep", "HOUSE"]),
        contributor("cy", ["Late night"]),
      ],
    });
    expect(summary).toEqual({
      people: 3,
      tags: [
        { label: "House", people: 2 },
        { label: "Late night", people: 2 },
        { label: "Deep", people: 1 },
      ],
    });
  });

  it("leaves out the listener's own public tags", () => {
    const entity = {
      contributors: [
        contributor("Me", ["Mine"]),
        contributor("own", ["Also mine"], { isOwn: true }),
        contributor("ana", ["House"]),
      ],
    };
    expect(summarizeCommunityTags(entity, "me")).toEqual({
      people: 1,
      tags: [{ label: "House", people: 1 }],
    });
  });

  it("shows nothing when no one else shared tags", () => {
    expect(summarizeCommunityTags(null)).toBeNull();
    expect(summarizeCommunityTags({ contributors: [contributor("ana", [])] })).toBeNull();
    expect(summarizeCommunityTags({ contributors: [contributor("me", ["Mine"])] }, "me")).toBeNull();
  });
});

describe("describeCommunityTags", () => {
  it("lists every tag under a heading naming the people count", () => {
    const [group] = describeCommunityTags({
      people: 4,
      tags: [{ label: "House", people: 3 }, { label: "Deep", people: 1 }],
    });
    expect(group.categoryName).toBe("Tagged by 4 people on Community");
    expect(group.tags.map((tag) => tag.name)).toEqual(["House · 3", "Deep"]);
    expect(describeCommunityTags({ people: 1, tags: [{ label: "House", people: 1 }] })[0].categoryName).toBe("Tagged by 1 person on Community");
  });
});

describe("createCommunityTagsChip", () => {
  it("shows the people count with the tags in its label", () => {
    const chip = createCommunityTagsChip({
      people: 2,
      tags: [{ label: "House", people: 2 }, { label: "Deep", people: 1 }],
    });
    expect(chip.className).toBe("tagify-playbar-community-tags");
    expect(chip.textContent).toBe("2");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(chip.getAttribute("aria-label")).toBe("Community tags: House, Deep");
    document.body.appendChild(chip);
    chip.dispatchEvent(new MouseEvent("mouseenter"));
    const popover = document.querySelector(".tagify-tag-popover");
    expect(popover?.textContent).toContain("Tagged by 2 people on Community");
    expect([...popover.querySelectorAll(".tagify-tag-popover-chip")].map((tag) => tag.textContent)).toEqual(["House · 2", "Deep"]);
    expect(popover.textContent).toContain("Click to see who tagged it in Tagify");
    chip.dispatchEvent(new MouseEvent("click"));
    expect(document.querySelector(".tagify-tag-popover")).toBeNull();
    chip.remove();
  });
});
