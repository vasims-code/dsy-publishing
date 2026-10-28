import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";
import { ServerDot } from "@/ui/ServerDot";
import { Button } from "@/ui/Button";
import { statusText } from "@/shell/NewTabPage";

export function NotAemScreen({ compact = false }) {
  const { activeTabId, navigate, servers, openSettingsTab, settings } = useApp();

  return (
    <div className={compact ? "" : "p-4"} data-testid="not-aem-screen">
      <div className={cn("flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-card text-center", compact ? "px-4 py-5" : "px-5 py-8")}>
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon name="Unplug" size={20} />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">Not an AEM page</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            This tab isn't on an AEM author server, so most tools can't act on it.
            Open one of your author servers — or use "From another server", which works from any tab.
          </p>
        </div>
      </div>

      <h3 className="mb-2 mt-5 px-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Known servers</h3>
      <div className="space-y-2">
        {servers.map((s) => {
          const st = statusText(s);
          return (
            <div key={s.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
              <ServerDot region={s.region} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                <div className={cn("truncate text-[11px]", st.tone)}>{st.text}</div>
              </div>
              <Button
                size="sm"
                variant={s.signedIn ? "primary" : "secondary"}
                disabled={!s.reachable}
                onClick={() => navigate(s.signedIn || s.checking || !settings.signInUrl?.trim() ? `${s.origin}/sites.html/content` : settings.signInUrl.trim(), activeTabId)}
                data-testid={`notaem-open-${s.id}`}
              >
                {s.signedIn || s.checking ? "Open" : s.reachable ? "Sign in" : "Can't reach"}
              </Button>
            </div>
          );
        })}
        <button type="button" onClick={openSettingsTab} className="flex items-center gap-1.5 px-0.5 pt-1 text-xs text-muted-foreground hover:text-primary">
          <Icon name="Plus" size={13} /> Add or edit servers in Settings
        </button>
      </div>
    </div>
  );
}
