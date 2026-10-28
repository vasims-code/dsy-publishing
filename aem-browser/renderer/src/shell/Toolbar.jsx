import { useEffect, useRef, useState } from "react";
import { useApp } from "@/state/AppContext";
import { cn } from "@/lib/utils";
import { IconButton } from "@/ui/IconButton";
import { Icon } from "@/ui/Icon";
import { ServerDot } from "@/ui/ServerDot";

function sessionLabel(server) {
  if (!server) return { text: "—", tone: "text-muted-foreground" };
  if (server.checking) return { text: "Checking…", tone: "text-muted-foreground" };
  if (server.signedIn) return { text: server.user ? `Signed in · ${server.user}` : "Signed in", tone: "text-status-green" };
  if (!server.reachable) return { text: "Can't reach", tone: "text-status-red" };
  if (server.state === "notaem") return { text: "Not an AEM server", tone: "text-muted-foreground" };
  return { text: "Not signed in", tone: "text-status-amber" };
}

function AddressBar() {
  const { activeTab, navigate, browser } = useApp();
  const url = activeTab?.url || "";
  const [text, setText] = useState(url);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setText(activeTab?.kind === "newtab" ? "" : url);
  }, [url, editing, activeTab?.id, activeTab?.kind]);

  useEffect(
    () =>
      browser.onCommand((cmd) => {
        if (cmd !== "focus-address") return;
        inputRef.current?.focus();
        inputRef.current?.select();
      }),
    [browser]
  );

  // A new tab starts with the cursor in the address bar.
  useEffect(() => {
    if (activeTab?.kind === "newtab") setTimeout(() => inputRef.current?.focus(), 0);
  }, [activeTab?.id, activeTab?.kind]);

  const submit = (e) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setEditing(false);
    inputRef.current?.blur();
    navigate(value, activeTab?.id);
  };

  const secure = url.startsWith("https:");
  return (
    <form onSubmit={submit} className="mx-1.5 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-input bg-card px-3 focus-within:border-ring">
      <Icon
        name={activeTab?.kind !== "page" ? "Search" : secure ? "Lock" : "Globe"}
        size={13}
        className="shrink-0 text-muted-foreground"
      />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => {
          setEditing(true);
          setText(e.target.value);
        }}
        onFocus={(e) => {
          setEditing(true);
          e.target.select();
        }}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setEditing(false);
            setText(url);
            e.currentTarget.blur();
            browser.focusPage();
          }
        }}
        spellCheck={false}
        placeholder="Search, enter an address, or type a /content/… path"
        data-testid="address-bar"
        className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-foreground placeholder:font-sans placeholder:text-muted-foreground focus:outline-none"
      />
      {activeTab?.zoom ? (
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {Math.round(Math.pow(1.2, activeTab.zoom) * 100)}%
        </span>
      ) : null}
    </form>
  );
}

export function Toolbar() {
  const { activeTab, serverOf, panel, togglePanel, openSettingsTab, browser, theme, toggleTheme } = useApp();
  const server = activeTab?.isAEM && activeTab.serverId ? serverOf(activeTab.serverId) : null;
  const status = sessionLabel(server);
  const page = activeTab?.kind === "page";
  const id = activeTab?.id;

  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    browser.showAppMenu({ x: r.right - 220, y: r.bottom + 4 });
  };

  return (
    <div className="flex h-12 items-center gap-1.5 border-b border-border bg-toolbar px-2.5">
      <IconButton icon="ArrowLeft" label="Back" disabled={!activeTab?.canGoBack} onClick={() => browser.back(id)} />
      <IconButton icon="ArrowRight" label="Forward" disabled={!activeTab?.canGoForward} onClick={() => browser.forward(id)} />
      {activeTab?.loading ? (
        <IconButton icon="X" label="Stop" onClick={() => browser.stop(id)} />
      ) : (
        <IconButton icon="RotateCw" label="Reload" disabled={!page} onClick={(e) => browser.reload(id, e.shiftKey)} />
      )}
      <IconButton icon="House" label="Home" onClick={() => browser.home(id)} />

      <AddressBar />

      {/* Server badge */}
      <div
        data-testid="server-badge"
        title={server ? `${server.host}${server.user ? ` — signed in as ${server.user}` : ""}` : "This tab is not on an AEM author server"}
        className="flex h-9 max-w-[240px] shrink-0 items-center gap-2 rounded-md border border-border bg-card px-2.5"
      >
        <ServerDot region={server?.region || "unknown"} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[12px] font-medium text-foreground">{server ? server.name : "No AEM server"}</div>
          <div className={cn("truncate text-[10px]", status.tone)}>{status.text}</div>
        </div>
      </div>

      <IconButton icon="PanelRight" label="Digital Samsung Yard" active={panel.open} onClick={togglePanel} data-testid="toolbar-toolkit" />
      <IconButton
        icon={theme === "dark" ? "Sun" : "Moon"}
        label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        onClick={toggleTheme}
        data-testid="toolbar-theme"
      />
      <IconButton icon="Settings" label="Settings" onClick={openSettingsTab} data-testid="toolbar-settings" />
      <IconButton icon="EllipsisVertical" label="Menu" onClick={openMenu} data-testid="toolbar-menu" />
    </div>
  );
}
