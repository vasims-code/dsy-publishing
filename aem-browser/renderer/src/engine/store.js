/**
 * The toolkit panel's state and flow - the extension's panel.js, without its DOM.
 *
 * The features describe themselves (meta.js: fields and flow) and draw their own
 * results (panel.js: renderResult, updateStep, renderDone, renderField). This store
 * runs the same two-step flow the extension does - analyze, review, then commit - and
 * hands each feature the containers to draw into. The React components only show it.
 *
 * Unlike the extension, the tab a run talks to is fixed when it is analyzed: the
 * review and the write go to the same tab even if another tab is brought forward.
 */
import { useSyncExternalStore } from "react";
import { SESSION, pickable, sessionNote } from "@toolkit/core/instances.js";
import { STORAGE_KEY, loadSettings } from "@toolkit/core/protocol.js";
import { loadAllMeta, loadPanel } from "@toolkit/features/registry.js";
import { icon } from "@toolkit/panel/icons.js";

export const PHASE = { INPUT: "input", REVIEW: "review", DONE: "done" };

/** The browser's tool switches (Settings → Tools) and card icons, by feature id. */
export const TOOLS = [
  { id: "page-copy", key: "backup", icon: "Copy" },
  { id: "page-upsert", key: "sync", icon: "GitCompareArrows" },
  { id: "page-transfer", key: "fromserver", icon: "Server" },
  { id: "page-versions", key: "versions", icon: "History", offByDefault: true },
  { id: "copy-deck", key: "copydeck", icon: "FileSpreadsheet", offByDefault: true },
  { id: "copy-deck-import", key: "import", icon: "FileInput", offByDefault: true },
];
export const toolOf = (id) => TOOLS.find((t) => t.id === id);

/** Why a server cannot be picked, short enough to follow its name in a list. */
export const sessionNoteOf = (s) => sessionNote(s || { state: SESSION.CHECKING });

export const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export { icon };

/** What the analysis on screen would remove, and whether it can run at all (Backup nests its sync). */
export function reviewFacts(result) {
  const r = result?.sync || result || {};
  return {
    nodes: r.counts?.nodesDeleted || 0,
    props: r.props?.deleted?.length || 0,
    blocked: (r.blockers?.length || 0) > 0,
    large: r.largeRemoval || null,
  };
}

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

class ToolkitStore {
  state = {
    ready: false,
    metas: [],
    settings: null,
    activeId: null,
    phase: PHASE.INPUT,
    busy: false,
    committing: false,
    commit: null,
    analysis: null,
    ack: false,
    stale: false,
    outcome: null,
    values: {},
    params: null,
    alerts: [],
    progress: null,
    tabId: null,
    origin: null,
    version: 0,
  };

  listeners = new Set();
  ctx = { tab: null, servers: [], sessions: {}, log: () => {} };
  resultEl = null;
  doneEl = null;
  customInputs = new Map();
  modules = new Map();
  runId = null;

  subscribe = (fn) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.state;

  set(patch) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }
  /** A feature's own result changed what the footer should offer. */
  bump() {
    this.set({ version: this.state.version + 1 });
  }

  async init() {
    if (this.started) return;
    this.started = true;
    const [metas, settings] = await Promise.all([loadAllMeta(), loadSettings()]);
    this.set({ ready: true, metas, settings });

    chrome.storage.onChanged.addListener(async (changes) => {
      if (changes[STORAGE_KEY]) this.set({ settings: await loadSettings() });
    });
    window.browser.onEngineReport((m) => this.onReport(m));
    document.addEventListener("aemt:flow-changed", () => {
      if (this.state.phase === PHASE.REVIEW && !this.state.busy) this.bump();
    });
    document.addEventListener("aemt:reanalyze", () => {
      if (this.meta() && this.state.phase === PHASE.REVIEW && !this.state.busy) this.analyze();
    });
  }

  setContext(ctx) {
    this.ctx = { ...this.ctx, ...ctx };
    // Instances signed in or out while the form is open: pickers move off one that cannot be used.
    const meta = this.meta();
    if (meta && this.state.phase === PHASE.INPUT && !this.state.busy && meta.fields.some((f) => f.type === "origin")) {
      const values = this.settleOrigins(meta, this.state.values);
      if (meta.fields.some((f) => values[f.name] !== this.state.values[f.name])) this.set({ values });
    }
  }

  meta() {
    return this.state.metas.find((m) => m.id === this.state.activeId) || null;
  }

  /** The settings a worker gets: the toolkit's own, with the browser's author servers as its instances. */
  engineSettings() {
    return { ...this.state.settings, origins: this.ctx.servers.map((s) => s.origin).filter(Boolean) };
  }

  currentOrigin() {
    const t = this.ctx.tab;
    return t?.kind === "page" && t.isAEM ? originOf(t.url) : null;
  }
  currentPage() {
    return this.currentOrigin() ? this.ctx.tab.path || null : null;
  }
  /** A feature that acts on "this tab" needs an author tab; one that names its servers does not. */
  gated(meta = this.meta()) {
    return meta?.requiresCurrentTab !== false && !this.currentOrigin();
  }

  prefillFor(f) {
    if (f?.prefill !== "currentPage") return "";
    const path = this.currentPage();
    if (!path) return "";
    return !f.prefillIf || f.prefillIf(path, this.state.settings) ? path : "";
  }

  /* ---------- instance pickers ---------- */

  sessionOf(origin) {
    return this.ctx.sessions[origin] || { state: SESSION.CHECKING };
  }

  /**
   * No picker rests on a server it cannot use, and two never name the same one. A field
   * defaulting to "current" starts on this tab's server.
   */
  settleOrigins(meta, values) {
    const pickers = meta.fields.filter((f) => f.type === "origin");
    if (!pickers.length) return values;
    const list = this.ctx.servers.map((s) => s.origin);
    const cur = this.currentOrigin();
    const v = { ...values };
    for (const f of pickers) if (!v[f.name] && f.default === "current" && list.includes(cur)) v[f.name] = cur;
    for (const f of pickers) {
      const taken = pickers.filter((g) => g !== f).map((g) => v[g.name]);
      const fits = (o) => !!o && pickable(this.sessionOf(o)) && !taken.includes(o);
      if (fits(v[f.name])) continue;
      const next = list.find(fits) || (!v[f.name] ? list.find((o) => !taken.includes(o)) : null);
      if (next) v[f.name] = next;
    }
    return v;
  }

  /* ---------- the form ---------- */

  defaults(meta) {
    const v = {};
    for (const f of meta.fields) {
      if (f.type === "checkbox") v[f.name] = f.default === true;
      else if (f.type === "origin") v[f.name] = "";
      else if (f.type !== "derived" && f.type !== "custom") v[f.name] = this.prefillFor(f);
    }
    return this.settleOrigins(meta, v);
  }

  openFeature(id) {
    if (this.state.busy) return;
    const meta = this.state.metas.find((m) => m.id === id);
    if (!meta) return;
    this.customInputs.clear();
    this.clearOutput();
    this.set({ activeId: id, phase: PHASE.INPUT, values: this.defaults(meta), params: null });
    if (meta.fields.some((f) => f.type === "origin")) window.browser.checkSessions(false);
  }

  goHome() {
    if (this.state.busy) return;
    this.clearOutput();
    this.set({ activeId: null, phase: PHASE.INPUT });
  }

  /** Changing anything invalidates an analysis on screen - including a checkbox. */
  invalidate(values = this.state.values) {
    if (this.state.phase !== PHASE.INPUT) {
      this.clearOutput();
      this.set({ phase: PHASE.INPUT, values });
    } else {
      this.set({ values });
    }
  }

  setField(name, value) {
    const meta = this.meta();
    const f = meta?.fields.find((x) => x.name === name);
    const values = { ...this.state.values, [name]: value };
    // Picking, in one list, the server the other has swaps the two.
    if (f?.type === "origin") {
      for (const g of meta.fields) {
        if (g.type === "origin" && g.name !== name && values[g.name] === value) values[g.name] = this.state.values[name];
      }
    }
    this.invalidate(values);
  }

  swap() {
    const meta = this.meta();
    if (!meta?.swap) return;
    const v = { ...this.state.values };
    for (const [a, b] of meta.swap) [v[a], v[b]] = [v[b] ?? "", v[a] ?? ""];
    this.invalidate(v);
  }

  derived(meta = this.meta(), values = this.state.values) {
    const out = {};
    for (const f of meta?.fields || []) {
      if (f.type !== "derived") continue;
      try {
        out[f.name] = { value: f.derive(values, this.state.settings) || "" };
      } catch (e) {
        out[f.name] = { value: "", problem: e.message };
      }
    }
    return out;
  }

  collect() {
    const meta = this.meta();
    const derived = this.derived(meta);
    const params = {};
    for (const f of meta.fields) {
      if (f.type === "checkbox") params[f.name] = !!this.state.values[f.name];
      else if (f.type === "custom") params[f.name] = String(this.customInputs.get(f.name)?.value || "").trim();
      else if (f.type === "derived") params[f.name] = derived[f.name].value;
      else params[f.name] = String(this.state.values[f.name] ?? "").trim();
    }
    return params;
  }

  /* ---------- output ---------- */

  async featurePanel(id) {
    if (!this.modules.has(id)) this.modules.set(id, await loadPanel(id));
    return this.modules.get(id);
  }

  clearOutput() {
    if (this.resultEl) this.resultEl.textContent = "";
    if (this.doneEl) this.doneEl.textContent = "";
    this.set({ analysis: null, outcome: null, commit: null, ack: false, stale: false, alerts: [], progress: null });
  }

  /** Every line goes to Activity; a failure also goes to the top, because it is why nothing happened. */
  log(level, message) {
    this.ctx.log(message, level === "fail" ? "error" : level);
    if (level === "fail") this.set({ alerts: [...this.state.alerts, message] });
  }

  onReport(m) {
    if (!this.runId || m.runId !== this.runId) return;
    if (m.level === "data") {
      if (m.message === "step") this.applyStep(this.state.activeId, m.data);
      else this.renderResult(this.state.activeId, m.data);
    } else {
      this.log(m.level, m.message);
    }
  }

  async renderResult(featureId, data) {
    const mod = await this.featurePanel(featureId);
    if (mod?.renderResult && this.resultEl) {
      this.resultEl.textContent = "";
      mod.renderResult(this.resultEl, data, { el });
    }
    this.updateProgress();
  }

  async applyStep(featureId, data) {
    const mod = await this.featurePanel(featureId);
    if (this.resultEl) mod?.updateStep?.(this.resultEl, data);
    this.updateProgress();
  }

  /** "4 of 7 steps", read off the plan the feature drew - every renderer marks its steps with data-state. */
  updateProgress() {
    const steps = this.state.committing && this.resultEl ? [...this.resultEl.querySelectorAll(".plan-step[data-state], .node[data-state]")] : [];
    const progress = steps.length ? { done: steps.filter((s) => s.dataset.state === "done").length, total: steps.length } : null;
    if (JSON.stringify(progress) !== JSON.stringify(this.state.progress)) this.set({ progress });
  }

  /* ---------- running ---------- */

  send(meta, action, params, tabId = this.state.tabId) {
    if (!tabId) return Promise.resolve({ ok: false, error: "Open a page on an author server first." });
    return window.browser.engineCommand(tabId, {
      runId: this.runId,
      feature: meta.id,
      action,
      params,
      settings: this.engineSettings(),
    });
  }

  /** What a feature that drives its own flow gets - the extension's featureContext. */
  context(meta, params) {
    return {
      params,
      settings: this.engineSettings(),
      meta,
      origin: this.state.origin,
      tabId: this.state.tabId,
      send: (action, p, tabId) => this.send(meta, action, p, tabId),
      tabFor: async (origin) => {
        const r = await window.browser.engineTabFor(origin);
        if (!r.ok) throw new Error(r.error);
        return r.tabId;
      },
      log: (level, message) => this.log(level, message),
      step: (id, st, note) => this.applyStep(meta.id, { id, state: st, note }),
    };
  }

  async analyze() {
    const meta = this.meta();
    if (!meta || this.state.busy) return;
    const params = this.collect();
    const missing = meta.fields.filter((f) => f.required && !params[f.name]);
    this.clearOutput();
    if (missing.length) return this.log("fail", `Fill in: ${missing.map((f) => f.label).join(", ")}`);
    if (this.gated(meta)) return this.log("fail", "Open a page on an author server in this tab first.");

    const origin = this.currentOrigin();
    this.runId = crypto.randomUUID();
    this.set({ busy: true, tabId: origin ? this.ctx.tab.id : null, origin, params });
    try {
      // Signed out, every request is sent to the WDS login and fails as "Failed to fetch". Say why first.
      if (origin && meta.requiresCurrentTab !== false) {
        const st = (await window.browser.checkSessions(true))[origin]?.state;
        if (st === SESSION.OUT) throw new Error(`You're not signed in to ${new URL(origin).host}. Sign in through WDS, then try again.`);
        if (st === SESSION.UNREACHABLE) throw new Error(`Can't reach ${new URL(origin).host}. Check the VPN, or that the server is up.`);
      }
      const mod = await this.featurePanel(meta.id);
      const res = mod?.analyze ? await mod.analyze(this.context(meta, params)) : await this.send(meta, meta.flow.analyze.action, params);
      if (res?.ok) {
        // The analysis can say the commit will do something other than the default - an update, not a create.
        const variant = meta.flow.variants?.[res.result?.variant];
        this.set({ phase: PHASE.REVIEW, analysis: res.result || null, commit: variant ? { ...meta.flow.commit, ...variant } : null });
      } else {
        this.set({ phase: PHASE.INPUT });
        if (!res?.aborted) this.log("fail", res?.error || "The analysis returned nothing.");
      }
    } catch (e) {
      this.set({ phase: PHASE.INPUT });
      this.log("fail", e.message);
    } finally {
      this.runId = null;
      this.set({ busy: false });
    }
  }

  async commitRun() {
    const meta = this.meta();
    if (!meta || this.state.busy) return;
    const params = this.collect();
    // What the tick box confirmed, so the run can refuse to remove more than that.
    if (this.state.ack) {
      const f = reviewFacts(this.state.analysis);
      params.removalsAck = { nodes: f.nodes, props: f.props };
    }
    this.runId = crypto.randomUUID();
    this.set({ busy: true, committing: true, alerts: [] });
    try {
      const mod = await this.featurePanel(meta.id);
      const res = mod?.commit ? await mod.commit(this.context(meta, params)) : await this.send(meta, meta.flow.commit.action, params);
      if (res?.ok) {
        this.set({ phase: PHASE.DONE, outcome: res.result || null });
        if (this.doneEl) {
          this.doneEl.textContent = "";
          mod?.renderDone?.(this.doneEl, res.result || null, { el, icon });
        }
      } else {
        // Part of it may be written: stay in review, offering a fresh analysis rather than the same run.
        this.set({ phase: PHASE.REVIEW, stale: true });
        await this.markStopped(meta);
        if (!res?.aborted) this.log("fail", res?.error || "The run returned nothing.");
      }
    } catch (e) {
      this.set({ phase: PHASE.REVIEW, stale: true });
      await this.markStopped(meta);
      this.log("fail", e.message);
    } finally {
      this.runId = null;
      this.set({ busy: false, committing: false });
      this.updateProgress();
    }
  }

  /** The step a stopped run was on shows as failed, not as still going. */
  async markStopped(meta) {
    const mod = await this.featurePanel(meta.id);
    for (const li of this.resultEl?.querySelectorAll('.plan-step[data-state="running"]') || []) {
      if (mod?.updateStep) mod.updateStep(this.resultEl, { id: li.dataset.step, state: "failed" });
      else li.dataset.state = "failed";
    }
  }

  backToInput() {
    if (this.state.busy) return;
    this.clearOutput();
    this.set({ phase: PHASE.INPUT });
  }

  setAck(ack) {
    this.set({ ack });
  }

  startAgain() {
    const meta = this.meta();
    const last = this.collect();
    this.clearOutput();
    this.set({ phase: PHASE.INPUT });
    // Same inputs, fresh look - for a feature whose run changes what it reads.
    if (meta.flow.done?.keepValues) return this.analyze();
    // Back to the feature's defaults; "another page" means another page, not the one just run.
    const v = { ...this.state.values };
    for (const f of meta.fields) {
      if (f.type === "checkbox") v[f.name] = f.default === true;
      else if (f.type === "custom") {
        const input = this.customInputs.get(f.name);
        if (input) input.value = "";
      } else if (f.type !== "derived" && f.type !== "origin") {
        const p = this.prefillFor(f);
        v[f.name] = p && p !== last[f.name] ? p : "";
      }
    }
    this.set({ values: v });
  }

  /** What the commit button says and whether it can run, including a feature's live choice. */
  commitView() {
    const meta = this.meta();
    const live = this.modules.get(meta.id)?.commitState?.();
    const base = this.state.commit || meta.flow.commit;
    const commit = live ? { ...base, ...live, disabled: base.disabled || !live.ready } : base;
    return { commit, live: !!live, facts: reviewFacts(this.state.analysis) };
  }
}

export const toolkit = new ToolkitStore();
export const useToolkit = () => useSyncExternalStore(toolkit.subscribe, toolkit.getSnapshot);
