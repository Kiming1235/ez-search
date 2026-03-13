const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { getStoreDir } = require("./store-path");

const STORE_DIR = getStoreDir();
const DEFAULT_SECRET_NAME = "api-key";
const SAFE_STORAGE_PREFIX = Buffer.from("SAFE1:");
const PLAINTEXT_PREFIX = Buffer.from("PLAIN1:");

function ensureStoreDir() {
  fs.mkdirSync(STORE_DIR, { recursive: true });
}

function getSecretPath(name = DEFAULT_SECRET_NAME) {
  const safeName = String(name || DEFAULT_SECRET_NAME).replace(/[^a-z0-9_-]/gi, "_");
  return path.join(STORE_DIR, `${safeName}.bin`);
}

function hasDpapi() {
  return Boolean(crypto.dpapi && typeof crypto.dpapi.protectData === "function");
}

function getSafeStorage() {
  if (!process.versions?.electron) {
    return null;
  }

  try {
    const { safeStorage } = require("electron");
    if (safeStorage && typeof safeStorage.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable()) {
      return safeStorage;
    }
  } catch {
    return null;
  }

  return null;
}

function hasPrefix(buffer, prefix) {
  return buffer.length > prefix.length && buffer.subarray(0, prefix.length).equals(prefix);
}

function saveSecret(secret, name = DEFAULT_SECRET_NAME) {
  ensureStoreDir();
  let stored;

  if (hasDpapi()) {
    stored = crypto.dpapi.protectData(Buffer.from(secret, "utf8"), null, "CurrentUser");
  } else {
    const safeStorage = getSafeStorage();
    if (safeStorage) {
      stored = Buffer.concat([SAFE_STORAGE_PREFIX, safeStorage.encryptString(secret)]);
    } else {
      stored = Buffer.concat([PLAINTEXT_PREFIX, Buffer.from(secret, "utf8")]);
    }
  }

  fs.writeFileSync(getSecretPath(name), stored);
}

function loadSecret(name = DEFAULT_SECRET_NAME) {
  const storePath = getSecretPath(name);

  if (!fs.existsSync(storePath)) {
    return "";
  }

  try {
    const encrypted = fs.readFileSync(storePath);
    if (hasPrefix(encrypted, SAFE_STORAGE_PREFIX)) {
      const safeStorage = getSafeStorage();
      if (!safeStorage) {
        return "";
      }
      return safeStorage.decryptString(encrypted.subarray(SAFE_STORAGE_PREFIX.length));
    }

    if (hasPrefix(encrypted, PLAINTEXT_PREFIX)) {
      return encrypted.subarray(PLAINTEXT_PREFIX.length).toString("utf8");
    }

    if (hasDpapi()) {
      return crypto.dpapi.unprotectData(encrypted, null, "CurrentUser").toString("utf8");
    }

    return "";
  } catch {
    return "";
  }
}

function clearSecret(name = DEFAULT_SECRET_NAME) {
  const storePath = getSecretPath(name);

  if (fs.existsSync(storePath)) {
    fs.unlinkSync(storePath);
  }
}

module.exports = {
  saveSecret,
  loadSecret,
  clearSecret,
  saveApiKey: (secret) => saveSecret(secret, "api-key"),
  loadApiKey: () => loadSecret("api-key"),
  clearApiKey: () => clearSecret("api-key"),
  saveRemoteApiToken: (secret) => saveSecret(secret, "remote-api-token"),
  loadRemoteApiToken: () => loadSecret("remote-api-token"),
  clearRemoteApiToken: () => clearSecret("remote-api-token"),
  saveRemoteRequestToken: (secret) => saveSecret(secret, "remote-request-token"),
  loadRemoteRequestToken: () => loadSecret("remote-request-token"),
  clearRemoteRequestToken: () => clearSecret("remote-request-token"),
};
