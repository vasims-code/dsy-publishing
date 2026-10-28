import { Icon } from "@/ui/Icon";
import { Switch } from "@/components/ui/switch";
import { TOOLS, useToolkit } from "@/engine/store";

export function ToolsSettings({ draft, update }) {
  const { metas } = useToolkit();
  const toggle = (key, v) => update({ tools: { ...draft.tools, [key]: v } });
  return (
    <div className="max-w-xl space-y-2">
      {TOOLS.map((t) => {
        const meta = metas.find((m) => m.id === t.id);
        if (!meta) return null;
        return (
          <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3" data-testid={`tool-setting-${t.key}`}>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon name={t.icon} size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {meta.title}
                {t.offByDefault && <span className="text-[10px] text-muted-foreground">(off by default)</span>}
              </div>
              <div className="text-xs text-muted-foreground">{meta.summary}</div>
            </div>
            <Switch checked={draft.tools[t.key] !== false} onCheckedChange={(v) => toggle(t.key, v)} />
          </div>
        );
      })}
    </div>
  );
}
