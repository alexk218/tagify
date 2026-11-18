import { describe, expect, it } from "vitest";
import { toSmallSpotifyCover } from "../trackCover";

const id = "0123456789abcdef01234567";

describe("toSmallSpotifyCover", () => {
  it("swaps 640px and 300px Spotify covers for the 64px version", () => {
    expect(toSmallSpotifyCover(`https://i.scdn.co/image/ab67616d0000b273${id}`)).toBe(`https://i.scdn.co/image/ab67616d00004851${id}`);
    expect(toSmallSpotifyCover(`https://i.scdn.co/image/ab67616d00001e02${id}`)).toBe(`https://i.scdn.co/image/ab67616d00004851${id}`);
  });

  it("keeps a 64px cover and converts spotify:image URIs", () => {
    expect(toSmallSpotifyCover(`https://i.scdn.co/image/ab67616d00004851${id}`)).toBe(`https://i.scdn.co/image/ab67616d00004851${id}`);
    expect(toSmallSpotifyCover(`spotify:image:ab67616d0000b273${id}`)).toBe(`https://i.scdn.co/image/ab67616d00004851${id}`);
  });

  it("leaves other https images alone and drops missing or unsafe values", () => {
    expect(toSmallSpotifyCover("https://mosaic.scdn.co/640/abc")).toBe("https://mosaic.scdn.co/640/abc");
    expect(toSmallSpotifyCover(`https://i.scdn.co/image/ab6761610000e5eb${id}`)).toBe(`https://i.scdn.co/image/ab6761610000e5eb${id}`);
    expect(toSmallSpotifyCover(null)).toBeNull();
    expect(toSmallSpotifyCover("")).toBeNull();
    expect(toSmallSpotifyCover("http://example.com/a.jpg")).toBeNull();
  });
});
