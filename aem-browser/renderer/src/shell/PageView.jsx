import { useApp } from "@/state/AppContext";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";

// The web page itself is drawn by the browser on top of this area. What shows here is
// only what is under it: a blank while it loads, or why it could not be loaded.
export function PageView() {
  const { activeTab, browser } = useApp();
  const err = activeTab?.error;
  if (!err) return <div className="h-full bg-white" data-testid="page-view" />;

  const crashed = err.code === "crashed";
  return (
    <div className="flex h-full flex-col items-center justify-center bg-surface p-8" data-testid="page-error">
      <div className="flex max-w-[520px] flex-col items-center gap-3 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon name={crashed ? "Frown" : "CloudOff"} size={26} />
        </div>
        <p className="text-base font-semibold text-foreground">{crashed ? "This page stopped working" : "This page can't be reached"}</p>
        <p className="break-all font-mono text-xs text-muted-foreground">{err.url}</p>
        <p className="text-xs text-muted-foreground">
          {crashed
            ? `The page's process ended (${err.description}).`
            : `${err.description || "The connection failed"} (${err.code}). If this is an author server, check you are on the VPN.`}
        </p>
        <Button variant="primary" icon="RotateCw" onClick={() => browser.reload(activeTab.id)}>
          Try again
        </Button>
      </div>
    </div>
  );
}
