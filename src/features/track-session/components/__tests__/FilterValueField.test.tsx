import React, { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FilterValueField } from "../FilterValueField";
import { formatLength, parseLengthInput } from "@/utils/songDetails";

function LengthField({ initial = null, onChange = () => {} }: { initial?: number | null; onChange?: (value: number | null) => void }) {
  const [value, setValue] = useState<number | null>(initial);
  return (
    <FilterValueField
      ariaLabel="Shortest song length"
      value={value}
      options={[120, 180, 240]}
      parse={parseLengthInput}
      format={formatLength}
      hint="Type a length like 3:30"
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

const field = () => screen.getByRole("combobox", { name: "Shortest song length" }) as HTMLInputElement;

describe("FilterValueField", () => {
  it("applies a typed length on Enter and shows it the way the list does", () => {
    const onChange = vi.fn();
    render(<LengthField onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "3.5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(210);
    expect(field().value).toBe("3:30");
  });

  it("applies typed text when leaving the field", () => {
    const onChange = vi.fn();
    render(<LengthField onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "3:15" } });
    fireEvent.blur(field());
    expect(onChange).toHaveBeenCalledWith(195);
  });

  it("explains text it can't read and puts the last value back", () => {
    const onChange = vi.fn();
    render(<LengthField initial={180} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "soon" } });
    // No hint while still typing ("3:3" on the way to "3:30" isn't a mistake yet).
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(screen.getByRole("status").textContent).toBe("Type a length like 3:30");
    expect(field().value).toBe("soon");
    fireEvent.blur(field());
    expect(onChange).not.toHaveBeenCalled();
    expect(field().value).toBe("3:00");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("clears back to Any when the field is emptied", () => {
    const onChange = vi.fn();
    render(<LengthField initial={180} onChange={onChange} />);
    fireEvent.change(field(), { target: { value: "" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(null);
    expect(field().placeholder).toBe("Any");
  });

  it("still offers the list of choices", () => {
    const onChange = vi.fn();
    render(<LengthField onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /choices/ }));
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Any", "2:00", "3:00", "4:00"]);
    fireEvent.click(screen.getByRole("option", { name: "4:00" }));
    expect(onChange).toHaveBeenCalledWith(240);
    expect(field().value).toBe("4:00");
  });
});
