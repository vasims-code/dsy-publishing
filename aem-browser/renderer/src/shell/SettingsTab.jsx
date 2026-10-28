import { useEffect, useState } from "react";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { Icon } from "@/ui/Icon";
import { Button } from "@/ui/Button";
import { ServersSettings } from "@/settings/ServersSettings";
import { ToolsSettings } from "@/settings/ToolsSettings";
import { AppearanceSettings } from "@/settings/AppearanceSettings";
import { BackupSettings } from "@/settings/BackupSettings";
import { SyncSettings } from "@/settings/SyncSettings";
import { FromServerSettings } from "@/settings/FromServerSettings";
import { CopyDeckFieldsSettings } from "@/settings/CopyDeckFieldsSettings";
import { loadSettings, saveSettings } from "@toolkit/core/protocol.js";

const SECTIONS = [
  { id: "servers", label: "Author servers", icon: "Server" },
  { id: "appearance", label: "Appearance", icon: "Palette" },
  { id: "tools", label: "Tools", icon: "LayoutGrid" },
  { id: "backup", label: "Backup", icon: "Copy" },
  { id: "sync", label: "Page sync", icon: "GitCompareArrows" },
  { id: "fromserver", label: "From another server", icon: "ArrowLeftRight" },
  { id: "copydeck", label: "Copy deck fields", icon: "FileSpreadsheet" },
];

/**
 * Two kinds of settings on one page: the browser's own (servers, sign-in, which tools show)
 * and the toolkit's (stored as the extension stores them, so its code reads them unchanged).
 */
export function SettingsTab() {
  const { settings, setSettings } = useApp();
  const [section, setSection] = useState("servers");
  const [draft, setDraft] = useState(() => structuredClone(settings));
  const [tk, setTkState] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings().then(setTkState);
  }, []);

  const update = (patch) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSaved(false);
  };
  const setTk = (patch) => {
    setTkState((t) => ({ ...t, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    const servers = draft.servers
      .filter((s) => s.host.trim())
      .map(({ id, name, host, region }) => ({ id, name: name.trim() || host.trim(), host: host.trim(), region }));
    // The theme is applied the moment it is picked (here or on the toolbar), so Save keeps whatever it is now.
    await setSettings({ ...draft, servers, theme: settings.theme });
    if (tk) await saveSettings({ ...tk, featureVersions: draft.tools?.versions !== false });
    setSaved(true);
  };

  const current = SECTIONS.find((s) => s.id === section);
  const needsSave = section !== "copydeck" && section !== "appearance";

  let body = null;
  if (section === "servers") body = <ServersSettings draft={draft} update={update} />;
  else if (section === "appearance") body = <AppearanceSettings draft={draft} update={update} />;
  else if (section === "tools") body = <ToolsSettings draft={draft} update={update} />;
  else if (section === "copydeck") body = <CopyDeckFieldsSettings />;
  else if (!tk) body = <p className="text-sm text-muted-foreground">Loading…</p>;
  else if (section === "backup") body = <BackupSettings tk={tk} setTk={setTk} />;
  else if (section === "sync") body = <SyncSettings tk={tk} setTk={setTk} />;
  else if (section === "fromserver") body = <FromServerSettings tk={tk} setTk={setTk} />;

  return (
    <div className="flex h-full bg-surface" data-testid="settings-tab">
      <nav className="w-60 shrink-0 border-r border-border bg-panel px-3 py-5">
        <div className="mb-4 flex items-center gap-2 px-2 text-sm font-semibold text-foreground">
          <Icon name="Settings" size={16} className="text-primary" /> Settings
        </div>
        <ul className="space-y-0.5">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setSection(s.id)}
                data-testid={`settings-nav-${s.id}`}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                  section === s.id ? "bg-primary/15 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon name={s.icon} size={15} /> {s.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-8 py-8">
          <div className="mb-6 flex items-center justify-between">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
              <Icon name={current.icon} size={20} className="text-muted-foreground" /> {current.label}
            </h1>
            {needsSave && (
              <div className="flex items-center gap-3">
                {saved && (
                  <span className="flex items-center gap-1 text-xs font-medium text-status-green animate-in-fade" data-testid="settings-saved">
                    <Icon name="Check" size={14} /> Saved
                  </span>
                )}
                <Button variant="primary" icon="Save" onClick={save} data-testid="settings-save">
                  Save
                </Button>
              </div>
            )}
          </div>
          {body}
        </div>
      </div>
    </div>
  );
}
