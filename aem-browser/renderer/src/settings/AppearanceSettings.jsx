import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";

// A miniature of the browser in each theme: tab strip, toolbar, page and panel.
function Preview({ dark }) {
  const c = dark
    ? { strip: "#1b1f22", page: "#14171a", panel: "#16191c", line: "#2a2f33", accent: "#2ec4b0", text: "#d9dee2" }
    : { strip: "#f4f6f8", page: "#ffffff", panel: "#f8f9fa", line: "#dde2e7", accent: "#18958a", text: "#1f2933" };
  return (
    <svg viewBox="0 0 120 72" className="w-full rounded-md" aria-hidden="true">
      <rect width="120" height="72" fill={c.page} />
      <rect width="120" height="12" fill={c.strip} />
      <rect x="4" y="4" width="26" height="8" rx="2" fill={c.page} />
      <rect y="12" width="120" height="10" fill={c.strip} />
      <rect x="18" y="14.5" width="60" height="5" rx="2.5" fill={c.page} stroke={c.line} strokeWidth="0.6" />
      <rect x="84" y="22" width="36" height="50" fill={c.panel} />
      <line x1="84" y1="22" x2="84" y2="72" stroke={c.line} strokeWidth="0.6" />
      <rect x="88" y="27" width="24" height="3" rx="1.5" fill={c.text} opacity="0.7" />
      <rect x="88" y="34" width="28" height="8" rx="2" fill={c.page} stroke={c.line} strokeWidth="0.6" />
      <rect x="88" y="45" width="28" height="8" rx="2" fill={c.page} stroke={c.line} strokeWidth="0.6" />
      <rect x="98" y="62" width="18" height="6" rx="2" fill={c.accent} />
      <rect x="8" y="30" width="50" height="4" rx="2" fill={c.text} opacity="0.55" />
      <rect x="8" y="38" width="66" height="3" rx="1.5" fill={c.text} opacity="0.25" />
      <rect x="8" y="44" width="60" height="3" rx="1.5" fill={c.text} opacity="0.25" />
    </svg>
  );
}

const CHOICES = [
  { id: "light", label: "Light", icon: "Sun", hint: "Always light." },
  { id: "dark", label: "Dark", icon: "Moon", hint: "Always dark." },
  { id: "system", label: "Match Windows", icon: "Monitor", hint: "Follows Windows' own light or dark setting, and changes with it." },
];

/** Applied at once, like the toolbar's sun/moon button; Save is not needed. */
export function AppearanceSettings({ update }) {
  const { setTheme, themeSetting } = useApp();
  const current = themeSetting;
  const pick = (id) => {
    update({ theme: id });
    setTheme(id);
  };
  return (
    <div className="max-w-2xl space-y-4">
      <p className="text-xs text-muted-foreground">Changes apply straight away. The sun/moon button on the toolbar switches between light and dark too.</p>
      <div className="grid grid-cols-3 gap-3" role="radiogroup" aria-label="Appearance">
        {CHOICES.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={current === c.id}
            onClick={() => pick(c.id)}
            data-testid={`theme-${c.id}`}
            className={cn(
              "flex flex-col gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors",
              current === c.id ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40"
            )}
          >
            {c.id === "system" ? (
              <div className="grid grid-cols-2 overflow-hidden rounded-md">
                <div className="overflow-hidden"><div className="w-[200%]"><Preview /></div></div>
                <div className="overflow-hidden"><div className="w-[200%] -translate-x-1/2"><Preview dark /></div></div>
              </div>
            ) : (
              <Preview dark={c.id === "dark"} />
            )}
            <span className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
              <Icon name={c.icon} size={14} className={current === c.id ? "text-primary" : "text-muted-foreground"} />
              {c.label}
            </span>
            <span className="text-[11px] leading-snug text-muted-foreground">{c.hint}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
