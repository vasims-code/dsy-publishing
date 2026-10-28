import { useEffect, useState } from "react";
import { Icon } from "@/ui/Icon";
import { Code, Note } from "@/settings/common";
import { FIELD_GROUPS } from "@toolkit/features/copy-deck/core.js";
import { chooseField, forgetField, loadFields, onFieldsChanged, regroupField } from "@toolkit/features/copy-deck/fields.js";

const input = "h-8 rounded-md border border-input bg-background px-2.5 font-mono text-[12px] focus:border-ring focus:outline-none";
const select = "h-8 appearance-none rounded-md border border-input bg-background pl-2 pr-7 text-[12px] focus:border-ring focus:outline-none";

function Select({ value, onChange, children, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${select} w-full`}>
        {children}
      </select>
      <Icon name="ChevronDown" size={12} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

// The copy deck's added and ignored fields. Saved as they change, like the toolkit's own list.
export function CopyDeckFieldsSettings() {
  const [fields, setFields] = useState({ add: [], ignore: [] });
  const [row, setRow] = useState({ component: "", prop: "", kind: "add", group: FIELD_GROUPS[0].id });
  const [problem, setProblem] = useState("");

  useEffect(() => {
    loadFields().then(setFields);
    onFieldsChanged(setFields);
  }, []);

  const run = (p) =>
    p.then(
      (f) => {
        setFields(f);
        setProblem("");
      },
      (e) => setProblem(e.message)
    );

  const addByHand = () => run(chooseField(row.kind, row)).then(() => setRow({ ...row, component: "", prop: "" }));

  return (
    <div className="space-y-6" data-testid="copydeck-fields-settings">
      <Note>
        Fields added to the copy deck, or ignored, from its <em>Fields not on the sheet</em> list. A field is a component and a property —{" "}
        <Code>cm-g-promo-banner</Code> and <Code>cardTitle</Code> — and counts on every page that component is on. For the page's own properties the component
        is the page's, like <Code>page-standard-pd</Code>. <Code>*</Code> means every component. Changes here apply at once; no Save needed.
      </Note>

      <div>
        <h4 className="mb-2 text-xs font-semibold text-foreground">Added to the sheet</h4>
        {fields.add.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
        <div className="space-y-2">
          {fields.add.map((f) => (
            <div key={f.component + "·" + f.prop} className="grid grid-cols-[1fr_1fr_190px_auto] items-center gap-2 rounded-md border border-border bg-card p-2">
              <span className="truncate font-mono text-[12px] text-foreground">{f.component}</span>
              <span className="truncate font-mono text-[12px] text-muted-foreground">{f.prop}</span>
              <Select value={f.group} onChange={(g) => run(regroupField(f, g))}>
                {FIELD_GROUPS.map((g) => (
                  <option key={g.id} value={g.id}>{g.label}</option>
                ))}
              </Select>
              <button type="button" onClick={() => run(forgetField(f))} className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-status-red" aria-label="Remove">
                <Icon name="X" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold text-foreground">Ignored</h4>
        {fields.ignore.length === 0 && <p className="text-xs text-muted-foreground">None yet.</p>}
        <div className="space-y-2">
          {fields.ignore.map((f) => (
            <div key={f.component + "·" + f.prop} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2 rounded-md border border-border bg-card p-2">
              <span className="truncate font-mono text-[12px] text-foreground">{f.component}</span>
              <span className="truncate font-mono text-[12px] text-muted-foreground">{f.prop}</span>
              <button type="button" onClick={() => run(forgetField(f))} className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-status-red" aria-label="Remove">
                <Icon name="X" size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-dashed border-border p-3">
        <h4 className="mb-2 text-xs font-semibold text-foreground">Add one by hand</h4>
        <div className="grid grid-cols-[1fr_1fr_150px] gap-2">
          <input value={row.component} onChange={(e) => setRow({ ...row, component: e.target.value })} placeholder="component" spellCheck={false} className={input} />
          <input value={row.prop} onChange={(e) => setRow({ ...row, prop: e.target.value })} placeholder="property" spellCheck={false} className={input} />
          <Select value={row.kind} onChange={(kind) => setRow({ ...row, kind })}>
            <option value="add">Add to the sheet</option>
            <option value="ignore">Ignore</option>
          </Select>
        </div>
        <div className="mt-2 flex gap-2">
          {row.kind === "add" && (
            <Select value={row.group} onChange={(group) => setRow({ ...row, group })} className="flex-1">
              {FIELD_GROUPS.map((g) => (
                <option key={g.id} value={g.id}>{g.label}</option>
              ))}
            </Select>
          )}
          <button type="button" onClick={addByHand} className="ml-auto flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:brightness-110">
            <Icon name="Plus" size={14} /> Add
          </button>
        </div>
        {problem && <p className="mt-2 text-xs text-status-red">{problem}</p>}
      </div>
    </div>
  );
}
