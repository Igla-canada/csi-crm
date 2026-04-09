"use client";

import { Search } from "lucide-react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const shellClass =
  "relative min-w-[300px] rounded-2xl border border-[#dce8f4] bg-[#fbfdff] px-4 py-3 shadow-sm";

const inputClass =
  "w-full min-w-0 bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400";

type Hit = { id: string; name: string; phone: string; vehicle: string };

export function HeaderClientSearchSkeleton() {
  return (
    <div className={shellClass} aria-hidden>
      <div className="flex items-center gap-3">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <div className="h-4 w-full max-w-[200px] rounded bg-slate-100/80" />
      </div>
    </div>
  );
}

export function HeaderClientSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const urlQ = pathname.startsWith("/clients") ? (searchParams.get("q") ?? "") : "";

  const [inputValue, setInputValue] = useState(urlQ);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(-1);

  const wrapRef = useRef<HTMLDivElement>(null);
  const listId = "header-client-search-listbox";

  useEffect(() => {
    setInputValue(urlQ);
  }, [urlQ]);

  useEffect(() => {
    const q = inputValue.trim();
    if (q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }

    const ac = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/clients/search?q=${encodeURIComponent(q)}`, { signal: ac.signal });
        if (!res.ok) {
          setHits([]);
          return;
        }
        const data = (await res.json()) as { clients?: Hit[] };
        setHits(Array.isArray(data.clients) ? data.clients : []);
      } catch {
        if (!ac.signal.aborted) setHits([]);
      } finally {
        if (!ac.signal.aborted) setLoading(false);
      }
    }, 280);

    return () => {
      window.clearTimeout(t);
      ac.abort();
    };
  }, [inputValue]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setHighlight(-1);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const goClient = useCallback(
    (id: string) => {
      setOpen(false);
      setHighlight(-1);
      router.push(`/clients/${id}`);
    },
    [router],
  );

  const goFullList = useCallback(() => {
    const q = inputValue.trim();
    setOpen(false);
    setHighlight(-1);
    if (q) {
      router.push(`/clients?q=${encodeURIComponent(q)}`);
    } else {
      router.push("/clients");
    }
  }, [inputValue, router]);

  const showPanel = open && inputValue.trim().length >= 2;

  return (
    <div ref={wrapRef} className={shellClass} role="search">
      <form
        className="flex items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          goFullList();
        }}
      >
        <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
        <label htmlFor="header-client-search-q" className="sr-only">
          Search clients by name, phone, or email
        </label>
        <input
          id="header-client-search-q"
          type="search"
          autoComplete="off"
          enterKeyHint="search"
          className={inputClass}
          placeholder="Search name, phone, email…"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setOpen(true);
            setHighlight(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (!showPanel || hits.length === 0) {
              if (e.key === "Escape") setOpen(false);
              return;
            }
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlight((h) => (h < hits.length - 1 ? h + 1 : 0));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlight((h) => (h <= 0 ? hits.length - 1 : h - 1));
            } else if (e.key === "Enter" && highlight >= 0 && hits[highlight]) {
              e.preventDefault();
              goClient(hits[highlight].id);
            } else if (e.key === "Escape") {
              setOpen(false);
              setHighlight(-1);
            }
          }}
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={showPanel ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={highlight >= 0 ? `header-search-opt-${hits[highlight]?.id}` : undefined}
        />
      </form>

      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
        >
          {loading ? (
            <div className="px-4 py-3 text-sm text-slate-500">Searching…</div>
          ) : hits.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500">No matching clients. Press Enter to search the full list.</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.id}
                type="button"
                id={`header-search-opt-${h.id}`}
                role="option"
                aria-selected={i === highlight}
                className={`flex w-full flex-col gap-0.5 border-0 px-4 py-2.5 text-left text-sm transition hover:bg-slate-50 ${
                  i === highlight ? "bg-slate-50" : ""
                }`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => goClient(h.id)}
              >
                <span className="font-semibold text-slate-900">{h.name}</span>
                <span className="text-xs text-slate-600">
                  <span className="font-medium text-slate-500">Phone</span> {h.phone}
                </span>
                <span className="text-xs text-slate-600">
                  <span className="font-medium text-slate-500">Vehicle</span> {h.vehicle}
                </span>
              </button>
            ))
          )}
          {!loading && hits.length > 0 ? (
            <button
              type="button"
              className="w-full border-t border-slate-100 px-4 py-2 text-left text-xs font-semibold text-[#1e5ea8] hover:bg-slate-50"
              onMouseDown={(e) => e.preventDefault()}
              onClick={goFullList}
            >
              See all matches on Clients page →
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
