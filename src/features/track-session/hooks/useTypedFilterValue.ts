import { useEffect, useState } from "react";
import type { TypedFilterValue } from "@/utils/songDetails";

export interface TypedFilterValueOptions {
  value: number | null;
  parse: (text: string) => TypedFilterValue;
  format: (value: number) => string;
  onChange: (value: number | null) => void;
}

/**
 * The text of a From/To filter field that accepts both a typed value and a
 * pick from its list. Typed text only filters once it's confirmed (Enter or
 * leaving the field), so half-typed numbers like "1" on the way to "124"
 * never narrow the list or push the other end of the range around.
 */
export function useTypedFilterValue({ value, parse, format, onChange }: TypedFilterValueOptions) {
  const shown = value === null ? "" : format(value);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const [rejected, setRejected] = useState(false);

  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);

  const choose = (next: number | null) => {
    setEditing(false);
    setRejected(false);
    setText(next === null ? "" : format(next));
    if (next !== value) onChange(next);
  };

  const revert = () => {
    setEditing(false);
    setRejected(false);
    setText(shown);
  };

  /**
   * Applies the typed text. Text that can't be read is kept with a hint when
   * confirmed with Enter (so it can be fixed), and put back to the last value
   * when leaving the field.
   */
  const commit = ({ keepIfUnreadable = false }: { keepIfUnreadable?: boolean } = {}) => {
    if (!editing) return;
    const next = parse(text);
    if (next !== undefined) choose(next);
    else if (keepIfUnreadable) setRejected(true);
    else revert();
  };

  const edit = (next: string) => {
    setEditing(true);
    setRejected(false);
    setText(next);
  };

  return {
    text,
    editing,
    /** Confirmed text that isn't a value ("3:7", "abc"); the field shows its hint. */
    invalid: rejected,
    edit,
    commit,
    choose,
    revert,
  };
}
