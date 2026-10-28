import { useEffect, useRef, useState } from "react";
import { useApp } from "@/state/AppContext";
import { IconButton } from "@/ui/IconButton";
import { Icon } from "@/ui/Icon";

// Find on page. A row of its own, not an overlay: the web page is drawn above anything laid over it.
export function FindBar({ onClose }) {
  const { browser, activeTab } = useApp();
  const [text, setText] = useState("");
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  useEffect(
    () =>
      browser.onCommand((cmd) => {
        if (cmd === "find") {
          inputRef.current?.focus();
          inputRef.current?.select();
        }
      }),
    [browser]
  );
  useEffect(() => browser.onFound((r) => r.tabId === activeTab?.id && setResult(r)), [browser, activeTab?.id]);
  useEffect(() => () => browser.stopFind(), [browser]);

  const search = (value, opts = {}) => {
    setText(value);
    if (!value) setResult(null);
    browser.find(value, opts);
  };
  const close = () => {
    browser.stopFind();
    onClose();
    browser.focusPage();
  };

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-toolbar px-3">
      <Icon name="Search" size={14} className="text-muted-foreground" />
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => search(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") search(text, { forward: !e.shiftKey, findNext: true });
          if (e.key === "Escape") close();
        }}
        placeholder="Find on page"
        className="h-7 w-72 rounded-md border border-input bg-card px-2.5 text-[13px] focus:border-ring focus:outline-none"
      />
      <span className="min-w-[70px] text-[12px] tabular-nums text-muted-foreground">
        {text && result ? (result.matches ? `${result.active} of ${result.matches}` : "No matches") : ""}
      </span>
      <IconButton icon="ChevronUp" label="Previous match" size={28} iconSize={15} disabled={!text} onClick={() => search(text, { forward: false, findNext: true })} />
      <IconButton icon="ChevronDown" label="Next match" size={28} iconSize={15} disabled={!text} onClick={() => search(text, { forward: true, findNext: true })} />
      <IconButton icon="X" label="Close find bar" size={28} iconSize={15} onClick={close} className="ml-auto" />
    </div>
  );
}
