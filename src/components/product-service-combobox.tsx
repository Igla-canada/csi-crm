"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";

export type ProductServiceComboboxOption = {
  code: string;
  label: string;
  matchTerms?: string;
  active?: boolean;
};

type ProductServiceComboboxProps = {
  value: string;
  onChange: (value: string) => void;
  options: ProductServiceComboboxOption[];
  placeholder?: string;
  /** Match Log a Call / timeline input styling */
  inputClassName?: string;
  disabled?: boolean;
};

const MAX_LIST = 40;

function optionMatchesQuery(
  o: ProductServiceComboboxOption,
  q: string,
): boolean {
  if (!q) return true;
  const label = o.label.toLowerCase();
  const code = o.code.toLowerCase();
  const terms = (o.matchTerms ?? "").toLowerCase();
  return label.includes(q) || code.includes(q) || terms.includes(q);
}

export function ProductServiceCombobox({
  value,
  onChange,
  options,
  placeholder,
  inputClassName,
  disabled,
}: ProductServiceComboboxProps) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const activeOptions = useMemo(
    () => options.filter((o) => o.active !== false),
    [options],
  );

  const filtered = useMemo(() => {
    const q = value.trim().toLowerCase();
    const list = activeOptions.filter((o) => optionMatchesQuery(o, q));
    return q ? list : list.slice(0, MAX_LIST);
  }, [value, activeOptions]);

  useEffect(() => {
    setHighlight(0);
  }, [value, filtered.length]);

  useEffect(() => {
    if (!open) return;
    function onDocMouseDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [open]);

  const pick = useCallback(
    (label: string) => {
      onChange(label);
      setOpen(false);
      inputRef.current?.focus();
    },
    [onChange],
  );

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp") && filtered.length > 0) {
      e.preventDefault();
      setOpen(true);
      setHighlight(e.key === "ArrowUp" ? filtered.length - 1 : 0);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h + 1) % filtered.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h - 1 + filtered.length) % filtered.length);
    } else if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      const row = filtered[highlight];
      if (row) pick(row.label);
    }
  };

  const showPanel = open && !disabled && filtered.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open) setOpen(true);
        }}
        onFocus={() => {
          if (!disabled && activeOptions.length > 0) setOpen(true);
        }}
        onBlur={() => {
          window.requestAnimationFrame(() => {
            if (!wrapRef.current?.contains(document.activeElement)) {
              setOpen(false);
            }
          });
        }}
        onKeyDown={onInputKeyDown}
        className={inputClassName}
      />
      {showPanel ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-auto rounded-2xl border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/5"
        >
          {filtered.map((o, i) => (
            <li key={o.code} role="none">
              <button
                type="button"
                role="option"
                aria-selected={i === highlight}
                className={`flex w-full items-center px-4 py-2.5 text-left text-sm text-slate-800 transition ${
                  i === highlight ? "bg-[#eaf2fb] text-[#17497f]" : "hover:bg-slate-50"
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(o.label);
                }}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
