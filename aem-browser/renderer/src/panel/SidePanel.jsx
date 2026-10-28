import { useEffect } from "react";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { PanelHeader } from "@/panel/PanelHeader";
import { PanelFooter } from "@/panel/PanelFooter";
import { ActivityDrawer } from "@/panel/ActivityDrawer";
import { PanelHome } from "@/panel/PanelHome";
import { ToolView } from "@/panel/ToolView";
import { toolkit, useToolkit } from "@/engine/store";

// Kept mounted while hidden: a run carries on, and what a feature drew stays where it was.
export function SidePanel({ open }) {
  const { panel, setPanelWidth, activeTab, servers, sessions, addActivity } = useApp();
  useToolkit();
  const meta = toolkit.meta();

  useEffect(() => {
    toolkit.init();
  }, []);
  useEffect(() => {
    toolkit.setContext({ tab: activeTab, servers, sessions, log: addActivity });
  }, [activeTab, servers, sessions, addActivity]);

  const startResize = (e) => {
    e.preventDefault();
    const move = (ev) => setPanelWidth(window.innerWidth - ev.clientX);
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  return (
    <aside
      data-testid="side-panel"
      style={{ width: panel.width }}
      className={cn("relative shrink-0 flex-col border-l border-border bg-panel", open ? "flex" : "hidden")}
    >
      <div
        onMouseDown={startResize}
        className="absolute left-0 top-0 z-20 h-full w-2.5 -translate-x-1/2 cursor-col-resize hover:bg-primary/40"
        data-testid="panel-resize"
      />
      <PanelHeader />
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">{meta ? <ToolView key={meta.id} meta={meta} /> : <PanelHome />}</div>
      <PanelFooter />
      <ActivityDrawer />
    </aside>
  );
}
