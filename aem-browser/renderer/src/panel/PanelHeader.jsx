import { useApp } from "@/state/AppContext";
import { IconButton } from "@/ui/IconButton";
import { PHASE, toolkit, useToolkit } from "@/engine/store";
import dsyIcon from "@/assets/dsy-icon.png";

export function PanelHeader() {
  const { activeTab, setPanelOpen } = useApp();
  const s = useToolkit();
  const meta = toolkit.meta();

  let title = "Digital Samsung Yard";
  let subtitle = activeTab?.kind === "page" ? activeTab.path || "" : "";
  if (meta) {
    subtitle = meta.title;
    if (s.committing) title = (s.commit || meta.flow.commit).busy || "Working…";
    else if (s.phase === PHASE.REVIEW) title = s.stale ? "Stopped part-way" : "Review before you run";
    else if (s.phase === PHASE.DONE) title = s.outcome?.title || meta.flow.done?.title || "Done";
    else {
      title = meta.title;
      subtitle = s.busy ? meta.flow.analyze.busy || "Working…" : "";
    }
  }

  const back = () => (s.phase === PHASE.REVIEW ? toolkit.backToInput() : toolkit.goHome());
  const pct = s.progress ? Math.round((s.progress.done / s.progress.total) * 100) : 0;

  return (
    <div className="shrink-0 border-b border-border bg-panel px-4 pt-3">
      <div className="flex items-center gap-2">
        {meta ? (
          <IconButton icon="ArrowLeft" label="Back" iconSize={16} size={28} disabled={s.busy} onClick={back} data-testid="panel-back" />
        ) : (
          <img src={dsyIcon} alt="" draggable={false} className="h-7 w-7" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{title}</div>
          {subtitle && (
            <div className="truncate font-mono text-[11px] text-muted-foreground" title={subtitle}>
              {subtitle}
            </div>
          )}
        </div>
        {s.progress && <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{s.progress.done} of {s.progress.total} steps</span>}
        <IconButton icon="X" label="Close panel" size={28} iconSize={15} onClick={() => setPanelOpen(false)} data-testid="panel-close" />
      </div>
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-transparent">
        {s.busy && (
          <div
            className={s.progress ? "h-full rounded-full bg-primary transition-all duration-300" : "h-full w-1/3 animate-pulse rounded-full bg-primary/60"}
            style={s.progress ? { width: pct + "%" } : undefined}
          />
        )}
      </div>
    </div>
  );
}
