import { useEffect, useRef } from "react";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";
import { Field, TextInput } from "@/ui/Field";
import { ServerDot } from "@/ui/ServerDot";
import { PHASE, el, icon, sessionNoteOf, toolkit, useToolkit } from "@/engine/store";
import { pickable } from "@toolkit/core/instances.js";

// The toolkit's icon names, as the design's icon set calls them.
const ICONS = {
  copy: "Copy", sync: "RefreshCw", server: "Server", page: "FileText", folder: "Folder", link: "Link",
  globe: "Globe", image: "Image", layers: "Layers", history: "History", info: "Info", alert: "TriangleAlert",
  check: "Check", x: "X", lock: "Lock", swap: "ArrowUpDown", arrow: "ArrowRight", external: "ExternalLink",
};

const hostOf = (origin) => {
  try {
    return new URL(origin).host;
  } catch {
    return origin || "";
  }
};

/** The info box: what the run does, one line each, and the full story folded underneath. */
function Callout({ meta }) {
  const c = meta.callout;
  return (
    <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5">
      {c && (
        <>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">{c.title}</p>
          <ul className="space-y-1.5">
            {(c.items || []).map(([name, text]) => (
              <li key={text} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <Icon name={ICONS[name] || "Dot"} size={14} className="mt-0.5 shrink-0 text-primary/80" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
          {c.note && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{c.note}</p>}
        </>
      )}
      <details className="mt-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground/80 hover:text-foreground">More about this</summary>
        <p className="mt-1.5 leading-relaxed">{meta.description}</p>
      </details>
    </div>
  );
}

function OriginPicker({ f, value, disabled }) {
  const { servers, sessions } = useApp();
  const current = toolkit.currentOrigin();
  return (
    <div className="relative">
      <select
        value={value || ""}
        disabled={disabled}
        onChange={(e) => toolkit.setField(f.name, e.target.value)}
        className="h-9 w-full appearance-none rounded-md border border-input bg-card pl-3 pr-8 text-sm text-foreground focus:border-ring focus:outline-none disabled:opacity-60"
      >
        {!servers.length && <option value="">No author servers — add one in Settings</option>}
        {servers.map((s) => {
          const st = sessions[s.origin];
          const note = sessionNoteOf(st);
          return (
            <option key={s.origin} value={s.origin} disabled={!pickable(st)}>
              {s.name}
              {s.origin === current ? "  (this tab)" : ""}
              {note ? `  — ${note}` : ""}
            </option>
          );
        })}
      </select>
      <Icon name="ChevronDown" size={15} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

/** A control the feature draws itself (the import's paste area). Its value sits in a hidden input. */
function CustomField({ meta, f, disabled }) {
  const host = useRef(null);
  useEffect(() => {
    const node = host.current;
    node.textContent = "";
    const input = document.createElement("input");
    input.type = "hidden";
    toolkit.customInputs.set(f.name, input);
    toolkit.featurePanel(meta.id).then((mod) => mod?.renderField?.(node, f, { el, icon, input, changed: () => toolkit.invalidate() }));
  }, [meta.id, f]);
  useEffect(() => {
    host.current?.querySelectorAll("input, textarea, button, select").forEach((i) => (i.disabled = disabled));
  }, [disabled]);
  return <div ref={host} className="tk" />;
}

function FieldRow({ meta, f, values, derived, disabled }) {
  if (f.type === "checkbox") {
    return (
      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 transition-colors hover:border-primary/40">
        <input
          type="checkbox"
          checked={!!values[f.name]}
          disabled={disabled}
          onChange={(e) => toolkit.setField(f.name, e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
        />
        <span>
          <span className="block text-[13px] text-foreground">{f.label}</span>
          {f.hint && <span className="mt-0.5 block text-xs text-muted-foreground">{f.hint}</span>}
        </span>
      </label>
    );
  }
  if (f.type === "derived") {
    const d = derived[f.name] || {};
    return (
      <Field label={f.label} hint={d.problem ? null : f.hint}>
        <div className="flex items-start gap-2 rounded-md border border-dashed border-border bg-muted/40 px-2.5 py-2">
          <Icon name="Lock" size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
          <span className={cn("break-all font-mono text-[12.5px]", d.value ? "text-foreground" : "text-muted-foreground")}>
            {d.value || f.placeholder}
          </span>
        </div>
        {d.problem && <p className="text-xs text-status-amber">{d.problem}</p>}
      </Field>
    );
  }
  if (f.type === "origin") {
    return (
      <Field label={f.label} hint={f.hint}>
        <OriginPicker f={f} value={values[f.name]} disabled={disabled} />
      </Field>
    );
  }
  if (f.type === "custom") {
    return (
      <Field label={f.label} hint={f.hint}>
        <CustomField meta={meta} f={f} disabled={disabled} />
      </Field>
    );
  }
  return (
    <Field label={f.label} hint={f.hint} htmlFor={`f-${f.name}`}>
      <TextInput
        id={`f-${f.name}`}
        mono
        value={values[f.name] ?? ""}
        placeholder={f.placeholder || ""}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => toolkit.setField(f.name, e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && toolkit.analyze()}
        className="disabled:opacity-60"
      />
    </Field>
  );
}

/** Why a server in a picker is greyed out, and what to do about it. */
function PickerNote({ meta, values }) {
  const { servers, sessions } = useApp();
  const pickers = meta.fields.filter((f) => f.type === "origin");
  if (!pickers.length) return null;
  const lines = [];
  if (pickers.length === 2 && servers.length < 2) lines.push("A page can't be brought from a server to itself. Add your other author server in Settings.");
  const by = (state) => servers.filter((s) => sessions[s.origin]?.state === state).map((s) => s.name);
  if (by("out").length) lines.push(`Not signed in to ${by("out").join(" and ")}. Sign in there (through WDS), then come back — the list is checked again.`);
  if (by("unreachable").length) lines.push(`Can't reach ${by("unreachable").join(" and ")}. Check the VPN, or that the server is up.`);
  if (!lines.length) return null;
  const blocked = pickers.some((f) => !values[f.name] || !pickable(sessions[values[f.name]]));
  return <p className={cn("text-xs leading-relaxed", blocked ? "text-status-amber" : "text-muted-foreground")}>{lines.join(" ")}</p>;
}

function ToolForm({ meta, hidden, disabled }) {
  const s = useToolkit();
  const derived = toolkit.derived(meta, s.values);
  const main = meta.fields.filter((f) => !f.advanced);
  const advanced = meta.fields.filter((f) => f.advanced);
  const row = (f) => <FieldRow key={f.name} meta={meta} f={f} values={s.values} derived={derived} disabled={disabled} />;

  return (
    <form className={cn("space-y-3", hidden && "hidden")} onSubmit={(e) => e.preventDefault()}>
      {main.map((f) => (
        <div key={f.name} className="space-y-3">
          {meta.swap && f.name === meta.swap[0][1] && (
            <div className="flex justify-center">
              <button
                type="button"
                disabled={disabled}
                onClick={() => toolkit.swap()}
                className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary disabled:opacity-50"
              >
                <Icon name="ArrowUpDown" size={13} /> Swap source and destination
              </button>
            </div>
          )}
          {row(f)}
        </div>
      ))}
      <PickerNote meta={meta} values={s.values} />
      <Callout meta={meta} />
      {advanced.length > 0 && (
        <details className="rounded-md border border-border bg-card px-3 py-2">
          <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground hover:text-foreground">Advanced</summary>
          <div className="mt-3 space-y-3">{advanced.map(row)}</div>
        </details>
      )}
    </form>
  );
}

/** Once analysed, the form is put away and what was analysed is shown instead. */
function Banner({ meta, params }) {
  if (!params) return null;
  const sides = meta.banner
    ? meta.banner(params)
    : [
        { label: "Source", path: params.source, origin: params.sourceOrigin },
        { label: "Destination", path: params.dest, origin: params.destOrigin },
      ];
  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-card p-3">
      {sides.map((side, i) => (
        <div key={side.label}>
          {i > 0 && <Icon name="ArrowDown" size={13} className="my-1 text-muted-foreground" />}
          <div className="flex items-baseline gap-2">
            <span className="w-[72px] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{side.label}</span>
            <div className="min-w-0">
              {side.origin && <div className="text-[11px] text-muted-foreground">{hostOf(side.origin)}</div>}
              <div className="break-all font-mono text-[12px] text-foreground" title={side.path}>{side.path || "—"}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Gate() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-dashed border-border bg-card p-3">
      <Icon name="Unplug" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
      <div>
        <p className="text-[13px] font-medium text-foreground">Open an AEM author tab</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          This tool works on the page in the current tab. Switch to a tab on your author server. "From another server" works from any tab.
        </p>
      </div>
    </div>
  );
}

function SignInWarning() {
  const { sessions } = useApp();
  const origin = toolkit.currentOrigin();
  if (!origin || sessions[origin]?.state !== "out") return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-status-amber/40 bg-status-amber/10 px-3 py-2 text-xs leading-relaxed text-status-amber">
      <Icon name="LogIn" size={14} className="mt-0.5 shrink-0" />
      <span>You're not signed in to {hostOf(origin)}. Sign in through WDS first, or every request will get the login page back.</span>
    </div>
  );
}

function Alerts({ alerts }) {
  if (!alerts.length) return null;
  return (
    <div className="space-y-2" aria-live="assertive">
      {alerts.map((a, i) => (
        <div key={i} className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2.5 text-status-red animate-in-fade">
          <Icon name="TriangleAlert" size={15} className="mt-0.5 shrink-0" />
          <p className="flex-1 text-xs leading-relaxed">{a}</p>
        </div>
      ))}
    </div>
  );
}

function DoneBox({ meta, outcome, params }) {
  const dest = outcome?.dest || params?.dest || params?.page;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-status-green/30 bg-status-green/10 p-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-status-green/20 text-status-green">
        <Icon name="Check" size={17} />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{outcome?.title || meta.flow.done?.title || "Done"}</p>
        {dest && <p className="break-all font-mono text-[11.5px] text-muted-foreground" title={dest}>{dest}</p>}
      </div>
    </div>
  );
}

/** Above the button: what the run will do, and the tick box when it removes content. */
function Confirm({ s }) {
  const { commit, live, facts } = toolkit.commitView();
  if (s.stale) {
    return (
      <div className="rounded-lg border border-status-amber/40 bg-status-amber/10 p-3 text-xs leading-relaxed">
        <p className="font-semibold text-foreground">The run stopped before it finished.</p>
        <p className="mt-1 text-muted-foreground">Part of it may already be written, so the plan above is out of date. Analyze again to see where things stand now.</p>
      </div>
    );
  }
  const removing = facts.nodes + facts.props;
  const showAsk = !commit.disabled || live;
  if (!showAsk && !(removing && !facts.blocked)) return null;
  const parts = [];
  if (facts.nodes) parts.push(`${facts.nodes} component${facts.nodes === 1 ? "" : "s"}`);
  if (facts.props) parts.push(`${facts.props} propert${facts.props === 1 ? "y" : "ies"}`);
  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-card p-3">
      {showAsk && (
        <div>
          <p className="text-[13px] font-semibold text-foreground">{commit.question || "Shall I proceed?"}</p>
          {commit.caption && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{commit.caption}</p>}
        </div>
      )}
      {removing > 0 && !facts.blocked && !s.committing && (
        <>
          <div className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-3 py-2 text-xs leading-relaxed text-status-red">
            <Icon name="TriangleAlert" size={14} className="mt-0.5 shrink-0" />
            <span>
              {facts.large
                ? `${facts.large} Check the tables above, and that these are the right two pages, before you run it.`
                : `This removes ${parts.join(" and ")} from the destination page. Check the tables above before you run it.`}
            </span>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-[13px] text-foreground">
            <input
              type="checkbox"
              checked={s.ack}
              disabled={s.busy}
              onChange={(e) => toolkit.setAck(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--status-red))]"
            />
            <span>
              {facts.large
                ? `These are the right pages — remove ${facts.nodes} component${facts.nodes === 1 ? "" : "s"} anyway`
                : "I understand content will be removed"}
            </span>
          </label>
        </>
      )}
    </div>
  );
}

export function ToolView({ meta }) {
  const s = useToolkit();
  const gated = toolkit.gated(meta);
  const input = s.phase === PHASE.INPUT;

  return (
    <div className="space-y-3 p-4" data-testid={`tool-${meta.id}`}>
      {input && gated && <Gate />}
      {input && !gated && <SignInWarning />}
      <ToolForm meta={meta} hidden={!input} disabled={s.busy || (gated && meta.requiresCurrentTab !== false)} />
      {!input && <Banner meta={meta} params={s.params} />}
      <Alerts alerts={s.alerts} />
      {s.phase === PHASE.DONE && <DoneBox meta={meta} outcome={s.outcome} params={s.params} />}
      <div ref={(n) => n && (toolkit.doneEl = n)} className="tk" />
      <div ref={(n) => n && (toolkit.resultEl = n)} className="tk tk-result" aria-live="polite" />
      {s.phase === PHASE.REVIEW && <Confirm s={s} />}
    </div>
  );
}

export { hostOf, ServerDot };
