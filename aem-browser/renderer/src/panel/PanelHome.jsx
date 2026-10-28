import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";
import { ServerDot } from "@/ui/ServerDot";
import { TOOLS, toolkit, useToolkit } from "@/engine/store";
import { NotAemScreen } from "@/panel/NotAemScreen";

export function PanelHome() {
  const { activeTab, serverOf, settings, addActivity } = useApp();
  const s = useToolkit();
  const onAem = !!toolkit.currentOrigin();
  const server = onAem && activeTab.serverId ? serverOf(activeTab.serverId) : null;
  const metas = s.metas.filter((m) => settings.tools?.[TOOLS.find((t) => t.id === m.id)?.key] !== false);

  const open = (meta) => {
    toolkit.openFeature(meta.id);
    addActivity(`Opened ${meta.title}`);
  };

  return (
    <div className="space-y-4 p-4">
      {onAem ? (
        <div className="rounded-lg border border-border bg-card p-3">
          <div className="mb-1 flex items-center gap-2">
            <Icon name="FileText" size={14} className="text-primary" />
            <span className="text-xs font-semibold text-foreground">Page open in this tab</span>
          </div>
          <p className="truncate font-mono text-[11px] text-muted-foreground" title={activeTab.path || activeTab.url}>
            {activeTab.path || "No page open here — the tools ask for a page path"}
          </p>
          <div className="mt-2 flex items-center gap-2 text-[11px]">
            <ServerDot region={server?.region || "unknown"} />
            <span className="truncate text-muted-foreground">{server?.name}</span>
            <span className={cn("shrink-0 font-medium", server?.signedIn ? "text-status-green" : "text-status-amber")}>
              · {server?.signedIn ? "Signed in" : server?.checking ? "Checking…" : "Not signed in"}
            </span>
          </div>
        </div>
      ) : (
        <NotAemScreen compact />
      )}

      <div>
        <h3 className="mb-2 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tools</h3>
        {!s.ready && <p className="px-0.5 text-xs text-muted-foreground">Loading…</p>}
        <div className="grid grid-cols-1 gap-2">
          {metas.map((m) => {
            const off = toolkit.gated(m);
            const t = TOOLS.find((x) => x.id === m.id);
            return (
              <button
                key={m.id}
                type="button"
                disabled={off}
                onClick={() => open(m)}
                data-testid={`tool-card-${m.id}`}
                className="group flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-all hover:border-primary/50 hover:shadow-sm disabled:pointer-events-none disabled:opacity-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary">
                  <Icon name={t?.icon || "Wrench"} size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-foreground">{m.title}</span>
                  <span className="line-clamp-2 block text-xs text-muted-foreground">{m.summary}</span>
                  {off && <span className="mt-0.5 block text-[11px] text-status-amber">Needs an AEM author tab</span>}
                </span>
                <Icon name="ChevronRight" size={16} className="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
