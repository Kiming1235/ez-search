const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("screenExplainOverlay", {
  submitSelection: (selectionBounds) => ipcRenderer.invoke("screen-explain:overlay-submit-selection", selectionBounds),
  cancel: () => ipcRenderer.invoke("screen-explain:overlay-cancel"),
});
