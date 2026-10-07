import { describe, expect, it, vi } from "vitest";
import { renderEnergyControl } from "../inlineEditor.energyControl";

function render(energy = 0) {
  const control = document.createElement("span");
  const onEnergy = vi.fn();
  renderEnergyControl(control, { energy, onEnergy });
  return { control, onEnergy };
}

function dispatchPointer(target, type, clientX) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
  });
  target.dispatchEvent(event);
}

describe("inline energy control", () => {
  it("renders a ten-step slider with its saved value", () => {
    const { control } = render(7);
    expect(control).toHaveAttribute("role", "slider");
    expect(control).toHaveAttribute("aria-valuemin", "1");
    expect(control).toHaveAttribute("aria-valuemax", "10");
    expect(control).toHaveAttribute("aria-valuenow", "7");
    expect(control.querySelectorAll(".tagify-energy-segment")).toHaveLength(10);
    expect(control).toHaveTextContent("E7");
  });

  it.each([
    ["ArrowRight", 8],
    ["ArrowLeft", 6],
    ["Home", 1],
    ["End", 10],
    ["Delete", 0],
  ])("supports %s from the keyboard", (key, expected) => {
    const { control, onEnergy } = render(7);
    control.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    expect(onEnergy).toHaveBeenCalledWith(expected);
  });

  it("starts an unset energy at one with an arrow key", () => {
    const { control, onEnergy } = render(0);
    control.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(onEnergy).toHaveBeenCalledWith(1);
  });

  it("previews and commits the segment under the pointer", () => {
    const { control, onEnergy } = render(3);
    control.querySelector(".tagify-energy-segments").getBoundingClientRect = () => ({
      left: 10,
      width: 100,
    });

    dispatchPointer(control, "pointermove", 85);
    expect(control).toHaveTextContent("E8");
    dispatchPointer(control, "pointerdown", 85);
    dispatchPointer(control, "pointerup", 85);
    expect(onEnergy).toHaveBeenCalledWith(8);
  });

  it("clears the current value when its segment is clicked again", () => {
    const { control, onEnergy } = render(7);
    control.querySelector(".tagify-energy-segments").getBoundingClientRect = () => ({
      left: 0,
      width: 100,
    });
    dispatchPointer(control, "pointerdown", 65);
    dispatchPointer(control, "pointerup", 65);
    expect(onEnergy).toHaveBeenCalledWith(0);
  });
});
