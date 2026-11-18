import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTypedFilterValue } from "@/features/track-session/hooks/useTypedFilterValue";
import type { TypedFilterValue } from "@/utils/songDetails";
import styles from "./FilterValueField.module.css";

interface FilterValueFieldProps {
  ariaLabel: string;
  value: number | null;
  /** The choices offered in the list, below "Any". */
  options: number[];
  parse: (text: string) => TypedFilterValue;
  format?: (value: number) => string;
  /** Shown while the typed text isn't a value yet. */
  hint: string;
  onChange: (value: number | null) => void;
}

/**
 * A From/To filter value that looks like the other dropdowns: type an exact
 * value, or open the list with the arrow (or the Down key) and pick one.
 * While typing, the list narrows to the choices that start with the text.
 */
export function FilterValueField({ ariaLabel, value, options, parse, format = String, hint, onChange }: FilterValueFieldProps) {
  const field = useTypedFilterValue({ value, parse, format, onChange });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState<{ left: number; top: number; minWidth: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const query = field.editing ? field.text.trim().toLowerCase() : "";
  const allItems: (number | null)[] = [null, ...options];
  const narrowed = query ? options.filter((option) => format(option).toLowerCase().startsWith(query)) : allItems;
  const items = narrowed.length ? narrowed : allItems;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  const openList = () => {
    setOpen(true);
    setActive(Math.max(0, items.indexOf(value)));
  };

  // The filter panel scrolls, so the list sits above the page instead of being clipped by it.
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setPosition({ left: rect.left, top: rect.bottom + 4, minWidth: rect.width });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      close();
    };
    const onScroll = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active, position]);

  const pick = (item: number | null) => {
    field.choose(item);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) return openList();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => Math.min(items.length - 1, Math.max(0, current + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (open && active >= 0 && items[active] !== undefined) pick(items[active]);
      else {
        field.commit({ keepIfUnreadable: true });
        close();
      }
    } else if (event.key === "Escape" && (open || field.editing)) {
      event.stopPropagation();
      if (open) close();
      else field.revert();
    }
  };

  return (
    <div ref={rootRef} className={`${styles.combo} ${field.invalid ? styles.invalid : ""}`}>
      <input
        ref={inputRef}
        className={styles.input}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-invalid={field.invalid || undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        placeholder="Any"
        value={field.text}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => {
          field.edit(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          field.commit();
          close();
        }}
      />
      <button
        type="button"
        className={styles.toggle}
        tabIndex={-1}
        aria-label={`Show ${ariaLabel.toLowerCase()} choices`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          inputRef.current?.focus();
          if (open) close();
          else openList();
        }}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M3.5 6l4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {field.invalid && <span className={styles.hint} role="status">{hint}</span>}
      {open && position && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className={styles.list}
          style={{ left: position.left, top: position.top, minWidth: position.minWidth }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {items.map((item, index) => (
            <li
              key={item ?? "any"}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={item === value}
              className={`${styles.option} ${index === active ? styles.active : ""}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(item)}
            >
              {item === null ? "Any" : format(item)}
            </li>
          ))}
        </ul>,
        document.body,
      )}
    </div>
  );
}
