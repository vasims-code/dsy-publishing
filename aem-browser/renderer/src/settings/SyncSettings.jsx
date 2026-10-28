import { Field } from "@/ui/Field";
import { CheckSetting, Code, ListSetting, Note } from "@/settings/common";

export function SyncSettings({ tk, setTk }) {
  return (
    <div className="max-w-xl space-y-6">
      <Note>Whether components removed at the source are removed at the destination is deliberately not here — it is a tick box on each run.</Note>
      <Field
        label="Extra hosts to rewrite"
        hint={
          <>
            <Code>www.samsung.com</Code> is always included. A canonical pointing at a host that is not listed is reported but left alone.
          </>
        }
      >
        <ListSetting value={tk.upsertHosts} onChange={(v) => setTk({ upsertHosts: v })} placeholder="cdn.example.com" />
      </Field>
      <Field
        label="Destination properties never overwritten"
        hint={
          <>
            These belong to the destination, not the source — <Code>hreflangGroup</Code> is the usual one.
          </>
        }
      >
        <ListSetting value={tk.upsertKeepAtDest} onChange={(v) => setTk({ upsertKeepAtDest: v })} placeholder="hreflangGroup" />
      </Field>
      <Field
        label="Sites whose images and links can be kept"
        hint="A page copied from one of these sites shows two tick boxes on the review, under Image paths updated and Links updated: untick them to keep pointing at that site's images (nothing is uploaded) or at its links, instead of uploading and re-pointing them."
      >
        <ListSetting value={tk.upsertSharedSites} onChange={(v) => setTk({ upsertSharedSites: v })} placeholder="global" />
      </Field>
      <div className="space-y-2">
        <CheckSetting checked={tk.upsertCopyAssets} onChange={(v) => setTk({ upsertCopyAssets: v })} label="Upload referenced DAM assets that are missing at the destination" />
        <CheckSetting checked={tk.upsertOverwriteAssets} onChange={(v) => setTk({ upsertOverwriteAssets: v })} label="Upload again, over assets that are already at the destination" />
        <CheckSetting checked={tk.upsertReorder} onChange={(v) => setTk({ upsertReorder: v })} label="Fix component order to match the source" />
        <CheckSetting checked={tk.upsertVersionFirst} onChange={(v) => setTk({ upsertVersionFirst: v })} label="Create a version of an existing destination page before writing" />
        <CheckSetting checked={tk.upsertStripReplication} onChange={(v) => setTk({ upsertStripReplication: v })} label="Clear inherited replication state on a newly created page" />
        <CheckSetting checked={tk.upsertRewriteShop} onChange={(v) => setTk({ upsertRewriteShop: v })} label="Rewrite shop.samsung.com links too" />
      </div>
    </div>
  );
}
