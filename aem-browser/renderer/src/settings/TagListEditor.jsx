import { useState } from "react";
import { Icon } from "@/ui/Icon";
import { cn } from "@/lib/utils";

// Chip list editor for simple string lists (hosts, properties, sites).
export function TagListEditor({ items, onChange, placeholder, mono = true, testId }) {
  const [val, setVal] = useState("");
  const add = () => {
    const v = val.trim();
    if (!v) return;
    onChange([...items, v]);
    setVal("");
  };
  return (
    <div data-testid={testId}>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {items.length === 0 && <span className="text-xs text-muted-foreground">None yet.</span>}
        {items.map((it, i) => (
          <span key={i} className={cn("inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px]", mono && "font-mono")}>
            {it}
            <button type="button" onClick={() => onChange(items.filter((_, idx) => idx !== i))} aria-label={`Remove ${it}`}>
              <Icon name="X" size={12} className="text-muted-foreground hover:text-status-red" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={placeholder}
          className={cn("h-8 flex-1 rounded-md border border-input bg-card px-2.5 text-sm focus:border-ring focus:outline-none", mono && "font-mono text-[12px]")}
        />
        <button type="button" onClick={add} className="flex h-8 items-center gap-1 rounded-md border border-border bg-card px-2.5 text-xs font-medium hover:bg-muted">
          <Icon name="Plus" size={14} /> Add
        </button>
      </div>
    </div>
  );
}
