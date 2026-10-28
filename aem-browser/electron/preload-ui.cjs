// The interface's only way to reach the browser: a fixed set of calls, no Node.
const { contextBridge, ipcRenderer } = require("electron");

const listen = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld("browser", {
  getState: call("state:get"),
  onTabs: listen("tabs"),
  onSettings: listen("settings"),
  onSessions: listen("sessions"),
  onRecent: listen("recent"),
  onCommand: listen("command"),
  onFound: listen("found"),

  newTab: call("tabs:new"),
  closeTab: call("tabs:close"),
  activateTab: call("tabs:activate"),
  moveTab: call("tabs:move"),
  navigate: call("tabs:navigate"),
  back: call("tabs:back"),
  forward: call("tabs:forward"),
  reload: call("tabs:reload"),
  stop: call("tabs:stop"),
  home: call("tabs:home"),
  openSettings: call("tabs:settings"),
  find: call("tabs:find"),
  stopFind: call("tabs:stopFind"),
  focusPage: call("tabs:focusPage"),
  setPageBounds: (rect) => ipcRenderer.send("tabs:bounds", rect),

  saveSettings: call("settings:save"),
  checkSessions: call("sessions:check"),
  showAppMenu: call("menu:app"),
  showTabMenu: call("menu:tab"),

  // The toolkit's engine, and the storage its settings live in.
  storageGetAll: call("storage:getAll"),
  storageSet: call("storage:set"),
  storageRemove: call("storage:remove"),
  engineCommand: call("engine:command"),
  engineTabFor: call("engine:tabFor"),
  onEngineReport: listen("engine:report"),
});
