import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ActivityHeatmap } from "../StatsCharts";

function daysFrom(year: number, month: number, day: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - 1, day + index);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return { date: key, count: index % 5 };
  });
}

const monthLabels = (container: HTMLElement) =>
  [...container.querySelectorAll("figure > div[aria-hidden='true'] span")].map((label) => label.textContent);

describe("ActivityHeatmap", () => {
  it("drops a partial first month's label rather than the next month's", () => {
    // Starts 19 October: only two weeks of October before November begins.
    const { container } = render(<ActivityHeatmap days={daysFrom(2025, 10, 19, 53 * 7)} />);
    expect(monthLabels(container).slice(0, 3)).toEqual(["Nov", "Dec", "Jan"]);
  });

  it("keeps the first month's label when there's room for it", () => {
    const { container } = render(<ActivityHeatmap days={daysFrom(2025, 10, 5, 53 * 7)} />);
    expect(monthLabels(container).slice(0, 2)).toEqual(["Oct", "Nov"]);
  });
});
