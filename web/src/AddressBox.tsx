// Address input with suggestions as you type: popular café areas that match,
// then any street, locality or landmark from Amazon Location.

import { useEffect, useRef, useState } from "react";
import { DEMO_AREAS, suggestPlaces } from "./api.ts";

export function AddressBox({ value, onChange, placeholder, required }: { value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean }) {
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const typed = useRef(false);
  const q = value.trim().toLowerCase();
  const local = DEMO_AREAS.filter((a) => !q || a.toLowerCase().includes(q)).slice(0, q ? 4 : 8);
  const items = [...local, ...remote.filter((r) => !local.includes(r))].slice(0, 10);

  useEffect(() => {
    if (!typed.current || q.length < 3) {
      setRemote([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => suggestPlaces(value).then((r) => live && setRemote(r)).catch(() => live && setRemote([])), 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [value]);

  const pick = (v: string) => {
    typed.current = false;
    onChange(v);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="addr" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <input
        value={value}
        placeholder={placeholder}
        required={required}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          typed.current = true;
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (!open || !items.length) return;
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((i) => (i + 1) % items.length));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((i) => (i <= 0 ? items.length - 1 : i - 1)));
          else if (e.key === "Enter" && active >= 0) (e.preventDefault(), pick(items[active]));
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && items.length > 0 && (
        <ul className="addr-list" role="listbox">
          {!q && <li className="addr-head">Popular café areas · or type any address</li>}
          {items.map((it, i) => (
            <li key={it} role="option" aria-selected={i === active}>
              <button type="button" tabIndex={-1} className={i === active ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(it)}>
                {local.includes(it) ? "★ " : "📍 "}
                {it}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
