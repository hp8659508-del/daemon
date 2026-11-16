"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

/** A styled dropdown: button + searchable list. Options can be disabled with a reason. */
export type PickOption = { value: string; label: string; hint?: string; disabled?: boolean };

export default function Picker({ value, onChange, options, placeholder = "Choose…", searchable = true, className = "" }:
  { value: string; onChange: (v: string) => void; options: PickOption[]; placeholder?: string; searchable?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const cur = options.find(o => o.value === value);
  const shown = options.filter(o => !q || `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div ref={box} className={`picker ${className}`}>
      <button type="button" className="picker-btn" data-open={open} onClick={() => { setOpen(!open); setQ(""); }}>
        <span className={`min-w-0 flex-1 truncate text-left ${cur ? "" : "text-faint"}`}>{cur ? cur.label : placeholder}</span>
        <ChevronDown size={15} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="picker-pop">
          {searchable && options.length > 6 && (
            <div className="picker-search"><Search size={13} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" /></div>
          )}
          <ul role="listbox">
            {shown.length === 0 && <li className="picker-empty">No matches</li>}
            {shown.map(o => (
              <li key={o.value}>
                <button type="button" role="option" aria-selected={o.value === value} disabled={o.disabled}
                  onClick={() => { onChange(o.value); setOpen(false); }}>
                  <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{o.label}</span>{o.hint && <span className="block truncate text-xs text-muted">{o.hint}</span>}</span>
                  {o.value === value && <Check size={14} className="shrink-0 text-cobalt-ink" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
