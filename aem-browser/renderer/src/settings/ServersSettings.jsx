import { Icon } from "@/ui/Icon";
import { cn } from "@/lib/utils";

const REGIONS = [
  { id: "eu", label: "EU (blue)", dot: "bg-server-eu" },
  { id: "asia", label: "Asia (green)", dot: "bg-server-asia" },
  { id: "unknown", label: "Unknown (grey)", dot: "bg-server-unknown" },
];

export function ServersSettings({ draft, update }) {
  const servers = draft.servers;
  const setServer = (i, patch) => update({ servers: servers.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const remove = (i) => update({ servers: servers.filter((_, idx) => idx !== i) });
  const add = () =>
    update({ servers: [...servers, { id: "srv" + Date.now(), name: "", host: "", region: "unknown" }] });

  return (
    <div className="space-y-3" data-testid="servers-settings">
      <div className="mb-5 rounded-lg border border-border bg-card p-3">
        <label className="mb-1 block text-xs font-medium text-foreground" htmlFor="signin-url">Sign in through</label>
        <input id="signin-url" value={draft.signInUrl || ""} placeholder="https://wds.samsung.com/" spellCheck={false}
          onChange={(e) => update({ signInUrl: e.target.value })}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 font-mono text-[12px] focus:border-ring focus:outline-none" />
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          The page the Sign in buttons open. Leave it empty to go straight to the server, which shows its own login page.
        </p>
      </div>
      {servers.map((s, i) => (
        <div key={s.id} className="grid grid-cols-[1fr_1fr_160px_auto] items-center gap-2 rounded-lg border border-border bg-card p-2.5">
          <input value={s.name} placeholder="Name" onChange={(e) => setServer(i, { name: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2.5 text-sm focus:border-ring focus:outline-none" />
          <input value={s.host} placeholder="author-host.example.com" spellCheck={false} onChange={(e) => setServer(i, { host: e.target.value })}
            className="h-8 rounded-md border border-input bg-background px-2.5 font-mono text-[12px] focus:border-ring focus:outline-none" />
          <div className="relative">
            <select value={s.region} onChange={(e) => setServer(i, { region: e.target.value })}
              className="h-8 w-full appearance-none rounded-md border border-input bg-background pl-7 pr-7 text-xs focus:border-ring focus:outline-none">
              {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <span className={cn("pointer-events-none absolute left-2.5 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full", REGIONS.find((r) => r.id === s.region)?.dot)} />
            <Icon name="ChevronDown" size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
          <button type="button" onClick={() => remove(i)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-status-red/10 hover:text-status-red" aria-label="Remove server">
            <Icon name="Trash2" size={15} />
          </button>
        </div>
      ))}
      <button type="button" onClick={add} data-testid="server-add"
        className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:border-primary/50 hover:text-primary">
        <Icon name="Plus" size={14} /> Add author server
      </button>
    </div>
  );
}
