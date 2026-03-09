const fs = require("fs");
const path = require("path");

const STORE_DIR = path.join(__dirname, ".local");
const STORE_PATH = path.join(STORE_DIR, "settings.json");

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function loadSettings() {
  if (!fs.existsSync(STORE_PATH)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveSettings(nextSettings) {
  ensureStoreDir();
  fs.writeFileSync(STORE_PATH, JSON.stringify(nextSettings, null, 2), "utf8");
}

module.exports = {
  loadSettings,
  saveSettings,
};
