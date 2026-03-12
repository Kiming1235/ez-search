const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("screenExplainDesktop", {
  listSources: () => ipcRenderer.invoke("screen-explain:list-sources"),
  setSelectedSource: (sourceId) => ipcRenderer.invoke("screen-explain:set-selected-source", sourceId),
  getQuickModeState: () => ipcRenderer.invoke("screen-explain:get-quick-mode-state"),
  enableQuickMode: () => ipcRenderer.invoke("screen-explain:enable-quick-mode"),
  disableQuickMode: () => ipcRenderer.invoke("screen-explain:disable-quick-mode"),
  startQuickCapture: () => ipcRenderer.invoke("screen-explain:start-quick-capture"),
  openExternal: (targetUrl) => ipcRenderer.invoke("screen-explain:open-external", targetUrl),
  onQuickModeChanged: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("screen-explain:quick-mode-changed", wrapped);
    return () => ipcRenderer.removeListener("screen-explain:quick-mode-changed", wrapped);
  },
  onQuickAnswer: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on("screen-explain:quick-answer", wrapped);
    return () => ipcRenderer.removeListener("screen-explain:quick-answer", wrapped);
  },
});
