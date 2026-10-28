import { cn } from "@/lib/utils";

export function Field({ label, hint, children, className, htmlFor }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-xs font-medium text-foreground">
          {label}
        </label>
      )}
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function TextInput({ className, mono, ...props }) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-input bg-card px-2.5 text-sm text-foreground",
        "placeholder:text-muted-foreground focus:border-ring focus:outline-none",
        mono && "font-mono text-[13px]",
        className
      )}
      {...props}
    />
  );
}

// A read-only "worked out live" value box (e.g. backup destination).
export function DerivedValue({ value, className }) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed border-border bg-muted/40 px-2.5 py-2 font-mono text-[13px] text-foreground break-all",
        className
      )}
    >
      {value}
    </div>
  );
}

export function CheckRow({ checked, onChange, label, sub, testId }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 hover:border-primary/40 transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
      />
      <span>
        <span className="block text-sm text-foreground">{label}</span>
        {sub && <span className="block text-xs text-muted-foreground">{sub}</span>}
      </span>
    </label>
  );
}

// "What happens" explainer box shown on tool forms.
export function WhatHappens({ children }) {
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-primary">What happens</p>
      <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
    </div>
  );
}
