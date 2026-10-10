import { expect, it } from "vitest";
import { listTags, matchTagList, parseTagList } from "../tagLists";
it("reads quoted commas, pasted brackets, escaped quotes and deduplicates names", () => {
  expect(parseTagList('House; warm\nHOUSE, "Jazz, Soul", "Say ""Hi"""')).toEqual(["HOUSE", "warm", "Jazz, Soul", 'Say "Hi"']);
  expect(parseTagList('["House", "Warm"]')).toEqual(["House", "Warm"]);
  expect(parseTagList('{House, Warm}')).toEqual(["House", "Warm"]);
  expect(() => parseTagList('"Unclosed')).toThrow("Close the quotation");
  expect(() => parseTagList(Array.from({ length: 101 }, (_, i) => `Tag ${i}`).join(","))).toThrow("100");
});
it("keeps duplicate names ambiguous and resolves a complete folder path", () => {
  const tags = listTags([{ id: "genre", name: "Genre", tags: [{ id: "a", name: "Warm" }], subcategories: [{ id: "mood", name: "Mood", tags: [{ id: "b", name: "Warm" }], subcategories: [{ id: "deep", name: "Deep", tags: [{ id: "c", name: "Focus" }] }] }] }]);
  expect(matchTagList(["Warm", "genre / mood / warm", "Focus", "Foc"], tags).map(row => row.matches.map(tag => tag.id))).toEqual([["a", "b"], ["b"], ["c"], []]);
});
