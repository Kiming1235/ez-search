const os = require("os");
const path = require("path");

function getElectronUserDataDir() {
  if (!process.versions?.electron) {
    return "";
  }

  try {
    const electron = require("electron");
    if (electron?.app && typeof electron.app.getPath === "function") {
      return electron.app.getPath("userData");
    }
  } catch {
    return "";
  }

  return "";
}

function getStoreDir() {
  const explicitDir = typeof process.env.SCREENEXPLAIN_STORE_DIR === "string"
    ? process.env.SCREENEXPLAIN_STORE_DIR.trim()
    : "";
  if (explicitDir) {
    return explicitDir;
  }

  const electronUserDataDir = getElectronUserDataDir();
  if (electronUserDataDir) {
    return path.join(electronUserDataDir, "local-store");
  }

  const appDataDir = process.env.APPDATA ? process.env.APPDATA.trim() : "";
  if (appDataDir) {
    return path.join(appDataDir, "ScreenExplain");
  }

  return path.join(os.homedir(), ".screenexplain");
}

module.exports = {
  getStoreDir,
};
