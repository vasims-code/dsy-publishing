import { useEffect, useRef, useState } from "react";
import { useApp } from "@/state/AppContext";
import { TabStrip } from "@/shell/TabStrip";
import { Toolbar } from "@/shell/Toolbar";
import { FindBar } from "@/shell/FindBar";
import { PageView } from "@/shell/PageView";
import { NewTabPage } from "@/shell/NewTabPage";
import { SettingsTab } from "@/shell/SettingsTab";
import { SidePanel } from "@/panel/SidePanel";

export function BrowserFrame() {
  const { activeTab, panel, browser } = useApp();
  const kind = activeTab?.kind;
  const showPanel = panel.open && kind !== "settings" && !!activeTab;
  const [findOpen, setFindOpen] = useState(false);
  const mainRef = useRef(null);

  // The web page is a separate view the browser lays over <main>; tell it where <main> is.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const report = () => {
      const r = el.getBoundingClientRect();
      browser.setPageBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
    };
    const ro = new ResizeObserver(report);
    ro.observe(el);
    window.addEventListener("resize", report);
    report();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [browser]);

  useEffect(() => browser.onCommand((cmd) => cmd === "find" && setFindOpen(true)), [browser]);
  useEffect(() => {
    if (kind !== "page") setFindOpen(false);
  }, [kind, activeTab?.id]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TabStrip />
      <Toolbar />
      {findOpen && kind === "page" && <FindBar onClose={() => setFindOpen(false)} />}
      <div className="flex min-h-0 flex-1">
        <main ref={mainRef} className="min-w-0 flex-1 overflow-hidden">
          {!activeTab && <EmptyState />}
          {kind === "page" && <PageView />}
          {kind === "newtab" && <NewTabPage />}
          {kind === "settings" && <SettingsTab />}
        </main>
        <SidePanel open={showPanel} />
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
      No tabs open.
    </div>
  );
}
