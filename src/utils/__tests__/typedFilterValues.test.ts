// @vitest-environment node
import { describe, expect, it } from "vitest";
import { formatLength, parseBpmInput, parseLengthInput, parseYearInput } from "@/utils/songDetails";

describe("typed song length", () => {
  it.each([
    ["3:30", 210],
    [" 3:05 ", 185],
    ["0:45", 45],
    ["12:00", 720],
    ["1:02:00", 3720],
    ["4", 240],
    ["3.5", 210],
    ["3,5", 210],
    ["4 min", 240],
    ["4m", 240],
    ["210s", 210],
    ["90 sec", 90],
  ])("reads %j as %d seconds", (text, seconds) => {
    expect(parseLengthInput(text)).toBe(seconds);
  });

  it.each(["", "   ", "Any", "any"])("treats %j as any length", (text) => {
    expect(parseLengthInput(text)).toBeNull();
  });

  it.each(["3:5", "3:75", "abc", "-3", "3:30:", "25:00:00", "3 hours"])("rejects %j", (text) => {
    expect(parseLengthInput(text)).toBeUndefined();
  });

  it("round-trips the lengths it shows", () => {
    for (const seconds of [60, 185, 210, 1200]) expect(parseLengthInput(formatLength(seconds))).toBe(seconds);
  });
});

describe("typed release year", () => {
  it("reads a four-digit year", () => {
    expect(parseYearInput("1995")).toBe(1995);
    expect(parseYearInput(" 2024 ")).toBe(2024);
  });

  it("treats an empty field as any year", () => {
    expect(parseYearInput("")).toBeNull();
    expect(parseYearInput("Any")).toBeNull();
  });

  it.each(["95", "19955", "199a", "0999", "-1995", "1995.5"])("rejects %j", (text) => {
    expect(parseYearInput(text)).toBeUndefined();
  });
});

describe("typed BPM", () => {
  it.each([
    ["124", 124],
    ["127.5", 128],
    ["127,4", 127],
    ["124 bpm", 124],
    ["  90 ", 90],
  ])("reads %j as %d", (text, bpm) => {
    expect(parseBpmInput(text)).toBe(bpm);
  });

  it("treats an empty field as any BPM", () => {
    expect(parseBpmInput("")).toBeNull();
    expect(parseBpmInput("any")).toBeNull();
  });

  it.each(["0", "1000", "fast", "-120", "12a"])("rejects %j", (text) => {
    expect(parseBpmInput(text)).toBeUndefined();
  });
});
