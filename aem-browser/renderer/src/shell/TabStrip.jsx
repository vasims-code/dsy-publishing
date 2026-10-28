import { useState } from "react";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";
import { ServerDot } from "@/ui/ServerDot";

// The window's minimise / maximise / close buttons are drawn over the right of this strip.
const WINDOW_CONTROLS_WIDTH = 140;

function TabIcon({ tab }) {
  const [broken, setBroken] = useState(null);
  if (tab.loading) return <Icon name="LoaderCircle" size={14} className="shrink-0 animate-spin text-primary" />;
  if (tab.favicon && broken !== tab.favicon) {
    return <img src={tab.favicon} alt="" draggable={false} className="h-3.5 w-3.5 shrink-0" onError={() => setBroken(tab.favicon)} />;
  }
  return <Icon name={tab.icon || "FileText"} size={14} className="shrink-0 opacity-70" />;
}

export function TabStrip() {
  const { tabs, activeTabId, setActiveTab, closeTab, addTab, serverOf, browser } = useApp();
  // Drag to reorder: the tab being dragged, and which side of which tab it would land on.
  const [drag, setDrag] = useState(null);

  const dropOn = (target) => {
    if (!drag || !drag.over) return setDrag(null);
    const ids = tabs.map((t) => t.id);
    const from = ids.indexOf(drag.id);
    let to = ids.indexOf(target) + (drag.side === "after" ? 1 : 0);
    if (from < to) to--;
    if (from >= 0 && to !== from) browser.moveTab(drag.id, to);
    setDrag(null);
  };

  return (
    <div
      className="flex h-10 items-stretch gap-1 border-b border-border bg-toolbar pl-2 pt-1.5 [-webkit-app-region:drag]"
      style={{ paddingRight: WINDOW_CONTROLS_WIDTH }}
      onDoubleClick={(e) => e.preventDefault()}
    >
      <div className="flex min-w-0 items-stretch gap-1 overflow-x-auto scrollbar-thin">
        {tabs.map((tab) => {
          const server = tab.serverId ? serverOf(tab.serverId) : null;
          const region = server?.region || "unknown";
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", tab.title || "");
                setDrag({ id: tab.id });
              }}
              onDragOver={(e) => {
                if (!drag) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
                if (drag.over !== tab.id || drag.side !== side) setDrag({ ...drag, over: tab.id, side });
              }}
              onDrop={(e) => {
                e.preventDefault();
                dropOn(tab.id);
              }}
              onDragEnd={() => setDrag(null)}
              onClick={() => setActiveTab(tab.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                browser.showTabMenu(tab.id);
              }}
              title={tab.url ? `${tab.title}\n${tab.url}` : tab.title}
              data-testid={`tab-${tab.id}`}
              className={cn(
                "group relative flex h-8 w-[200px] min-w-[110px] shrink cursor-pointer items-center gap-2 rounded-t-md border border-b-0 px-2.5 text-[13px] transition-colors [-webkit-app-region:no-drag]",
                drag?.id === tab.id && "opacity-50",
                active
                  ? "border-border bg-background text-foreground"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-background/50"
              )}
            >
              {drag?.over === tab.id && drag.id !== tab.id && (
                <span className={cn("absolute inset-y-1 w-0.5 rounded bg-primary", drag.side === "before" ? "-left-[3px]" : "-right-[3px]")} />
              )}
              {tab.kind === "page" && <ServerDot region={tab.isAEM ? region : "unknown"} className={cn(!tab.isAEM && "opacity-0")} />}
              <TabIcon tab={tab} />
              <span className="truncate">{tab.title}</span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                data-testid={`tab-close-${tab.id}`}
                className={cn(
                  "ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-muted",
                  active ? "opacity-70" : "opacity-0 group-hover:opacity-100"
                )}
                aria-label="Close tab"
              >
                <Icon name="X" size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={() => addTab({})}
        data-testid="tab-new"
        title="New tab (Ctrl+T)"
        className="my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground [-webkit-app-region:no-drag]"
        aria-label="New tab"
      >
        <Icon name="Plus" size={16} />
      </button>
    </div>
  );
}
