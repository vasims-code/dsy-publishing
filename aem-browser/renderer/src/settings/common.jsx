import { TagListEditor } from "@/settings/TagListEditor";

/** A comma-separated setting (the toolkit stores these lists as one string), edited as chips. */
export function ListSetting({ value, onChange, placeholder, testId }) {
  const items = String(value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return <TagListEditor items={items} onChange={(list) => onChange(list.join(", "))} placeholder={placeholder} testId={testId} />;
}

export function CheckSetting({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/40">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />
      <span>
        <span className="block text-[13px] text-foreground">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function Note({ children }) {
  return <p className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

export const Code = ({ children }) => <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
