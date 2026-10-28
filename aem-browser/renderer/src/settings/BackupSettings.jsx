import { Field, TextInput } from "@/ui/Field";
import { CheckSetting, Code } from "@/settings/common";

export function BackupSettings({ tk, setTk }) {
  return (
    <div className="max-w-xl space-y-6">
      <Field
        label="Backup folder"
        hint={
          <>
            Inserted directly under the site root to form every backup path: <Code>/content/samsung/levant/tvs</Code> is backed up to{" "}
            <Code>/content/samsung/levant/india/backup/tvs</Code>.
          </>
        }
      >
        <TextInput mono value={tk.backupFolder} placeholder="india/backup" spellCheck={false} onChange={(e) => setTk({ backupFolder: e.target.value })} />
      </Field>
      <Field label="Template for pages with no source counterpart" hint="Used for inserted path segments that do not exist in the source.">
        <TextInput mono value={tk.marketingTemplate} spellCheck={false} onChange={(e) => setTk({ marketingTemplate: e.target.value })} />
      </Field>
      <Field
        label="Site root depth"
        hint={
          <>
            How many leading path segments must already exist. 3 means <Code>/content/&lt;brand&gt;/&lt;locale&gt;</Code> is never created.
          </>
        }
      >
        <TextInput type="number" min={1} max={10} value={tk.rootDepth} onChange={(e) => setTk({ rootDepth: Number(e.target.value) || 1 })} className="w-24" />
      </Field>
      <CheckSetting checked={tk.verifyShallow} onChange={(v) => setTk({ verifyShallow: v })} label="After copying, check that no child pages came across" />
    </div>
  );
}
