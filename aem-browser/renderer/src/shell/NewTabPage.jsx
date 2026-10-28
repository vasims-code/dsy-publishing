import { useEffect, useState } from "react";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";
import { ServerDot } from "@/ui/ServerDot";
import { Button } from "@/ui/Button";
import dsyIcon from "@/assets/dsy-icon.png";

export function statusText(s) {
  if (s.checking) return { text: "Checking…", tone: "text-muted-foreground" };
  if (s.signedIn) return { text: s.user ? `Signed in as ${s.user}` : "Signed in", tone: "text-status-green" };
  if (!s.reachable) return { text: "Can't reach — on the VPN?", tone: "text-status-red" };
  if (s.state === "notaem") return { text: "Not an AEM author server", tone: "text-status-amber" };
  return { text: "Not signed in", tone: "text-status-amber" };
}

export function ago(at) {
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}

export function NewTabPage() {
  const { servers, recent, navigate, activeTabId, openSettingsTab, browser, settings } = useApp();
  const [query, setQuery] = useState("");

  useEffect(() => {
    browser.checkSessions(false);
  }, [browser]);

  const open = (url) => navigate(url, activeTabId);
  const hostToServer = (host) => servers.find((s) => s.host.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase() === host);

  return (
    <div className="scrollbar-thin h-full overflow-y-auto bg-surface" data-testid="new-tab-page">
      <div className="mx-auto max-w-[900px] px-8 py-12">
        <div className="mb-10 flex flex-col items-center gap-4">
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-3">
              <img src={dsyIcon} alt="" draggable={false} className="h-10 w-10" />
              <span className="text-2xl font-bold tracking-[0.18em] text-foreground">DSY</span>
            </div>
            <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Digital Samsung Yard</span>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) open(query.trim());
            }}
            className="flex h-11 w-full max-w-[560px] items-center gap-2.5 rounded-full border border-input bg-card px-4 shadow-sm focus-within:border-ring"
          >
            <Icon name="Search" size={16} className="text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or enter an address"
              data-testid="newtab-search"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </form>
        </div>

        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Author servers</h2>
          <button type="button" onClick={() => browser.checkSessions(true)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
            <Icon name="RefreshCw" size={11} /> Check again
          </button>
        </div>
        {servers.length === 0 && (
          <div className="mb-10 rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            No author servers yet.{" "}
            <button type="button" onClick={openSettingsTab} className="font-medium text-primary hover:underline">
              Add one in Settings
            </button>
          </div>
        )}
        <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {servers.map((s) => {
            const st = statusText(s);
            return (
              <div
                key={s.id}
                data-testid={`server-card-${s.id}`}
                className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
              >
                <div className="flex items-start gap-2.5">
                  <ServerDot region={s.region} size="md" className="mt-1.5" />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-foreground">{s.name}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{s.host}</div>
                    <div className={cn("mt-0.5 truncate text-[11px] font-medium", st.tone)}>{st.text}</div>
                  </div>
                </div>
                <div className="mt-auto flex gap-2">
                  {s.signedIn || s.checking ? (
                    <Button size="sm" variant="primary" icon="SquarePen" onClick={() => open(`${s.origin}/sites.html/content`)} data-testid={`open-editor-${s.id}`}>
                      Open Sites
                    </Button>
                  ) : s.reachable ? (
                    <Button size="sm" variant="primary" icon="LogIn" onClick={() => open(settings.signInUrl?.trim() || `${s.origin}/sites.html/content`)}>
                      Sign in
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" icon="RefreshCw" onClick={() => browser.checkSessions(true)}>
                      Try again
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent pages</h2>
        {recent.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Pages you open on an author server will be listed here.
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {recent.slice(0, 12).map((p, i) => {
              const server = hostToServer(p.host);
              return (
                <button
                  key={p.host + p.path}
                  type="button"
                  onClick={() => open(p.url)}
                  data-testid={`recent-page-${i}`}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50",
                    i !== 0 && "border-t border-border"
                  )}
                >
                  <Icon name="FileText" size={15} className="shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{p.title}</div>
                    <div className="truncate font-mono text-[11px] text-muted-foreground">{p.path}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <ServerDot region={server?.region || "unknown"} />
                    <span className="hidden sm:inline">{server?.name || p.host}</span>
                    <span className="tabular-nums">· {ago(p.at)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
