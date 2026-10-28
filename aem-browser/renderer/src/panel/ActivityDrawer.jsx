import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";

const LEVEL = { error: "text-status-red", fail: "text-status-red", warn: "text-status-amber", ok: "text-status-green", skip: "text-muted-foreground", info: "text-foreground/80" };

export function ActivityDrawer() {
  const { activity, clearActivity, drawerOpen, setDrawerOpen } = useApp();
  return (
    <div className="shrink-0 border-t border-border bg-panel">
      <button
        type="button"
        onClick={() => setDrawerOpen(!drawerOpen)}
        data-testid="activity-toggle"
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-muted/40"
      >
        <Icon name={drawerOpen ? "ChevronDown" : "ChevronUp"} size={14} className="text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">Activity</span>
        <span className="rounded-full bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{activity.length}</span>
        <span className="ml-auto">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); clearActivity(); }}
            data-testid="activity-clear"
            className="text-[11px] font-medium text-primary hover:underline"
          >
            Clear
          </span>
        </span>
      </button>
      {drawerOpen && (
        <div className="scrollbar-thin max-h-40 overflow-y-auto border-t border-border px-4 py-2 font-mono text-[11px]">
          {activity.length === 0 && <p className="py-2 text-muted-foreground">No activity yet.</p>}
          {activity.slice().reverse().map((a, i) => (
            <div key={i} className="flex gap-2 py-0.5">
              <span className="shrink-0 text-muted-foreground/70 tabular-nums">{a.time}</span>
              <span className={cn("flex-1", LEVEL[a.level] || "text-foreground")}>{a.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
