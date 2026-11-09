/**
 * The test harness: a stand-in for Chrome and the panel shell, so a screen
 * can be rendered and looked at without the extension around it.
 *
 * Nothing here ships. It exists so the tests can say what a screen actually
 * drew, rather than what it was meant to draw.
 */

/* What the current scenario wants the tab to answer. Tests set this. */
export const tab = {
  reply: async () => ({ ok: true, result: null }),
  sent: [],
  report: null
};

let reportListener = null;

export function installChrome({ origins = ['https://p6-ap-author.samsung.com'], settings = {} } = {}) {
  const store = {
    'aemt.settings': { origins, settingsVersion: 2, ...settings },
    'aemt.copyDeck.added': [],
    'aemt.copyDeck.ignored': []
  };
  globalThis.chrome = {
    tabs: {
      query: async (q) => {
        if (q?.url && !q.url.startsWith(origins[0])) {
          return origins[1] ? [{ id: 2, url: `${origins[1]}/`, title: 'other' }] : [];
        }
        return [{ id: 1, url: `${origins[0]}/editor.html/content/samsung/uk/offers/spring-sale.html`, title: 'Spring sale' }];
      },
      create: async () => ({ id: 3 }),
      sendMessage: async (tabId, msg) => {
        if (msg?.type === 'aemt:release') return { ok: true };
        if (msg?.type === 'aemt:session') return { state: 'in', user: 'tester' };
        tab.sent.push({ tabId, ...msg });
        return tab.reply(msg, tabId);
      },
      onActivated: { addListener() {} },
      onUpdated: { addListener() {} }
    },
    permissions: { contains: async () => true, request: async () => true, remove: async () => true },
    storage: {
      onChanged: { addListener() {} },
      sync: { get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : { ...store }), set: async (o) => Object.assign(store, o) },
      local: { get: async () => ({}), set: async () => {} }
    },
    runtime: {
      getURL: (p) => '/' + p,
      openOptionsPage() {},
      onMessage: { addListener(fn) { reportListener = fn; } },
      sendMessage: async (m) => (m?.type === 'aemt:ensure-content-script' ? { ok: true } : { ok: true })
    }
  };
}

/** A progress line, as a worker would send one. */
export const report = (runId, data) =>
  reportListener?.({ type: 'aemt:report', runId, level: 'data', message: 'step', data });

/**
 * An ordinary line, as a worker reports one while it works - what it read,
 * what it wrote, what it skipped. These are what the activity log keeps.
 */
export const say = (runId, level, message) =>
  reportListener?.({ type: 'aemt:report', runId, level, message });

/** The run id of the request in flight, so a test can report against it. */
export const lastRunId = () => tab.sent[tab.sent.length - 1]?.runId;

/** A panel for one screen, detached from the document. */
export function makeCtx({ state = {}, own = {} } = {}) {
  const view = document.createElement('div');
  const footer = document.createElement('div');
  footer.className = 'footer';
  const ctx = {
    view,
    footer,
    own,
    state: {
      settings: { origins: ['https://p6-ap-author.samsung.com'], rootDepth: 3, backupFolder: 'india/backup' },
      origin: 'https://p6-ap-author.samsung.com',
      tab: { id: 1 },
      session: { state: 'in' },
      page: { path: '/content/samsung/uk/offers/spring-sale', title: 'Spring sale' },
      ...state
    },
    el: (t, c, x) => {
      const n = document.createElement(t);
      if (c) n.className = c;
      if (x != null) n.textContent = x;
      return n;
    },
    icon: () => document.createElement('span'),
    render: () => {},
    goHome: () => {
      ctx.wentHome = true;
    },
    openTool: (id) => {
      ctx.openedTool = id;
    },
    back: () => {
      ctx.wentBack = true;
    },
    wentHome: false,
    openedTool: null,
    wentBack: false
  };
  /* Re-rendering is what a screen does after every change, so the harness
     does the same: clear and draw again with the same state. */
  ctx.render = () => {
    view.textContent = '';
    footer.textContent = '';
    return ctx.draw?.();
  };
  return ctx;
}

/** Everything the panel would show, as one string. */
export const shown = (ctx) => `${ctx.view.innerText || ctx.view.textContent}\n${ctx.footer.innerText || ctx.footer.textContent}`;

/** Wait for the screen to settle after an action. */
export const settle = (ms = 60) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until something is true, rather than for a length of time.
 *
 * A fixed wait makes a test that passes on a fast run and fails on a slow
 * one - which says nothing about the code.
 */
export async function until(cond, { ms = 3000, every = 20 } = {}) {
  const stop = Date.now() + ms;
  for (;;) {
    const got = cond();
    if (got) return got;
    if (Date.now() > stop) throw new Error('waited too long for the screen to get there');
    await settle(every);
  }
}

/** Find a button by the words on it. */
export function btn(ctx, text) {
  const all = [...ctx.footer.querySelectorAll('button'), ...ctx.view.querySelectorAll('button')];
  return all.find((b) => (b.textContent || '').toLowerCase().includes(text.toLowerCase())) || null;
}

export function input(ctx, ariaLabel) {
  return (
    ctx.view.querySelector(`input[aria-label="${ariaLabel}"]`) ||
    ctx.view.querySelector(`textarea[aria-label="${ariaLabel}"]`)
  );
}

export function setValue(node, value) {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
}

export function tick(node, on = true) {
  node.checked = on;
  node.dispatchEvent(new Event('change', { bubbles: true }));
}
