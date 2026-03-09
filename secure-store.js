const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STORE_DIR = path.join(__dirname, ".local");
const STORE_PATH = path.join(STORE_DIR, "openai-key.bin");

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function saveApiKey(apiKey) {
  ensureStoreDir();
  const encrypted = crypto.dpapi.protectData(Buffer.from(apiKey, "utf8"), null, "CurrentUser");
  fs.writeFileSync(STORE_PATH, encrypted);
}

function loadApiKey() {
  if (!fs.existsSync(STORE_PATH)) {
    return "";
  }

  try {
    const encrypted = fs.readFileSync(STORE_PATH);
    return crypto.dpapi.unprotectData(encrypted, null, "CurrentUser").toString("utf8");
  } catch {
    return "";
  }
}

function clearApiKey() {
  if (fs.existsSync(STORE_PATH)) {
    fs.unlinkSync(STORE_PATH);
  }
}

module.exports = {
  saveApiKey,
  loadApiKey,
  clearApiKey,
};
