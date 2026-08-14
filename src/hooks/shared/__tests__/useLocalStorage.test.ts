import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLocalStorage } from "@/hooks/shared/useLocalStorage";

describe("useLocalStorage", () => {
  it.each(["123", "true", "null", "{\"tag\":\"value\"}"])(
    "keeps string storage values as strings for %s",
    (storedValue) => {
      localStorage.setItem("tagify:testString", storedValue);

      const { result } = renderHook(() =>
        useLocalStorage<string>("tagify:testString", ""),
      );

      expect(result.current[0]).toBe(storedValue);
      expect(typeof result.current[0]).toBe("string");
    },
  );

  it("continues parsing object storage values as JSON", () => {
    localStorage.setItem("tagify:testObject", JSON.stringify({ enabled: true }));

    const { result } = renderHook(() =>
      useLocalStorage("tagify:testObject", { enabled: false }),
    );

    expect(result.current[0]).toEqual({ enabled: true });
  });

  it("persists string updates as raw strings", () => {
    const { result } = renderHook(() =>
      useLocalStorage<string>("tagify:testStringUpdate", ""),
    );

    act(() => {
      result.current[1]("456");
    });

    expect(localStorage.getItem("tagify:testStringUpdate")).toBe("456");
    expect(result.current[0]).toBe("456");
  });
});
