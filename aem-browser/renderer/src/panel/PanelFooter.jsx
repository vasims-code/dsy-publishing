import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";
import { PHASE, toolkit, useToolkit } from "@/engine/store";

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return "";
  }
};

/** Which server a run would talk to, and whether you are signed in there. */
function ConnectionStatus({ origin }) {
  const { servers, sessions } = useApp();
  if (!origin) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="connection-status">
        <span className="h-1.5 w-1.5 rounded-full bg-status-grey" /> No AEM tab
      </div>
    );
  }
  const server = servers.find((s) => s.origin === origin);
  const st = sessions[origin]?.state;
  const ok = st === "in";
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground" data-testid="connection-status">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", ok ? "bg-status-green" : st === "out" ? "bg-status-amber" : "bg-status-grey")} />
      <span className="truncate">
        {server?.name || hostOf(origin)} · {ok ? "Signed in" : st === "out" ? "Not signed in" : st === "unreachable" ? "Can't reach" : "Checking…"}
      </span>
    </div>
  );
}

function Footer({ status, children }) {
  return (
    <div className="shrink-0 space-y-2 border-t border-border bg-panel px-4 py-3" data-testid="panel-footer">
      {status}
      {children && <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>}
    </div>
  );
}

export function PanelFooter() {
  const { addTab } = useApp();
  const s = useToolkit();
  const meta = toolkit.meta();
  const origin = s.phase === PHASE.INPUT ? toolkit.currentOrigin() : s.origin || toolkit.currentOrigin();
  const status = <ConnectionStatus origin={origin} />;

  if (!meta) return <Footer status={status} />;
  const ready = !toolkit.gated(meta) && !s.busy;

  if (s.phase === PHASE.INPUT) {
    const a = meta.flow.analyze;
    return (
      <Footer status={status}>
        <Button variant="ghost" disabled={s.busy} onClick={() => toolkit.goHome()}>Cancel</Button>
        <Button variant="primary" icon={s.busy ? null : "ScanSearch"} disabled={!ready} onClick={() => toolkit.analyze()} data-testid="btn-analyze">
          {s.busy && <Icon name="LoaderCircle" size={15} className="animate-spin" />}
          {s.busy ? a.busy || a.label : a.label}
        </Button>
      </Footer>
    );
  }

  if (s.phase === PHASE.REVIEW && s.stale) {
    return (
      <Footer status={status}>
        <Button variant="ghost" disabled={s.busy} onClick={() => toolkit.backToInput()}>{meta.flow.commit.back || "Change paths"}</Button>
        <Button variant="primary" icon="ScanSearch" disabled={!ready} onClick={() => toolkit.analyze()}>Analyze again</Button>
      </Footer>
    );
  }

  if (s.phase === PHASE.REVIEW) {
    const { commit, facts } = toolkit.commitView();
    const removing = facts.nodes + facts.props;
    const disabled = s.busy || commit.disabled || facts.blocked || (removing > 0 && !s.ack);
    const label = facts.blocked ? "This cannot run — see above" : s.busy ? commit.busy || commit.label : commit.label;
    return (
      <Footer status={status}>
        <Button variant="ghost" disabled={s.busy} onClick={() => toolkit.backToInput()} data-testid="btn-edit">{commit.back || "Change paths"}</Button>
        <Button
          variant={commit.tone === "danger" ? "danger" : "primary"}
          disabled={disabled}
          onClick={() => toolkit.commitRun()}
          data-testid="btn-run"
        >
          {s.busy ? <Icon name="LoaderCircle" size={15} className="animate-spin" /> : <Icon name="Play" size={15} />}
          {label}
        </Button>
      </Footer>
    );
  }

  // Done
  const url = s.outcome?.editorUrl;
  const base = s.params?.destOrigin || s.origin;
  const editor = url ? (/^https?:\/\//.test(url) ? url : base ? base + url : null) : null;
  return (
    <Footer status={status}>
      <Button variant="ghost" onClick={() => toolkit.goHome()}>Done</Button>
      <Button variant={editor ? "secondary" : "primary"} icon="RefreshCw" onClick={() => toolkit.startAgain()} data-testid="btn-start-another">
        {meta.flow.done?.again || "Start another"}
      </Button>
      {editor && (
        <Button variant="primary" icon="ExternalLink" onClick={() => addTab({ url: editor })} data-testid="btn-open-editor">
          Open in the editor
        </Button>
      )}
    </Footer>
  );
}
