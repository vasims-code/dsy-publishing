import { Field } from "@/ui/Field";
import { CheckSetting, Code, ListSetting, Note } from "@/settings/common";

export function FromServerSettings({ tk, setTk }) {
  return (
    <div className="max-w-xl space-y-6">
      <Note>
        Page metadata — <Code>ogTitle</Code>, the twitter handles, the page description — is always kept as it already is at the destination, because a
        locale's own wording cannot be derived from another one's. A page being created has nothing to keep, so it gets the source values as a starting point
        to edit.
      </Note>
      <Field label="Also keep as it is at the destination" hint="Anything else this locale owns and maintains itself.">
        <ListSetting value={tk.transferPreserve} onChange={(v) => setTk({ transferPreserve: v })} placeholder="localContent" />
      </Field>
      <div className="space-y-2">
        <CheckSetting checked={tk.transferCopyAssets} onChange={(v) => setTk({ transferCopyAssets: v })} label="Upload referenced images that are not at the destination yet" />
        <CheckSetting checked={tk.transferOverwriteAssets} onChange={(v) => setTk({ transferOverwriteAssets: v })} label="Re-upload images that are already at the destination" />
      </div>
    </div>
  );
}
