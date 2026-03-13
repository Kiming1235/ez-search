const {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  screen,
  session,
  shell,
  Tray,
} = require("electron");
const path = require("path");
const { PORT, startServer } = require("./server");

const QUICK_CAPTURE_SHORTCUT = "CommandOrControl+Shift+S";
const SHOW_MAIN_SHORTCUT = "CommandOrControl+Shift+M";
const TOGGLE_QUICK_MODE_SHORTCUT = "CommandOrControl+Shift+Q";
const MAX_QUICK_IMAGE_DATA_URL_LENGTH = 120000;
const QUICK_IMAGE_MAX_EDGE = 1400;
const QUICK_IMAGE_MIN_EDGE = 480;

let mainWindow = null;
let overlayWindow = null;
let localServer = null;
let selectedSourceId = null;
let quickModeEnabled = false;
let activeQuickDisplay = null;
let tray = null;

function createTrayIcon() {
  return nativeImage
    .createFromPath(path.join(__dirname, "assets", "tray-icon.png"))
    .resize({ width: 16, height: 16 });
}

async function getRawDisplaySources(types = ["screen", "window"], thumbnailSize = { width: 0, height: 0 }) {
  return desktopCapturer.getSources({
    types,
    thumbnailSize,
  });
}

async function listDisplaySources() {
  const sources = await getRawDisplaySources();
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    kind: source.id.startsWith("screen:") ? "screen" : "window",
  }));
}

function notifyQuickModeChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("screen-explain:quick-mode-changed", {
      quickModeEnabled,
      captureShortcut: "Ctrl+Shift+S",
      showMainShortcut: "Ctrl+Shift+M",
      toggleShortcut: "Ctrl+Shift+Q",
    });
  }
}

function notifyQuickAnswer(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("screen-explain:quick-answer", payload);
  }
}

function imageToJpegDataUrl(image, quality) {
  return `data:image/jpeg;base64,${image.toJPEG(quality).toString("base64")}`;
}

function constrainImageSize(image, maxEdge) {
  const size = image.getSize();
  const width = Math.max(size.width || 1, 1);
  const height = Math.max(size.height || 1, 1);
  const longestEdge = Math.max(width, height);
  if (longestEdge <= maxEdge) {
    return image;
  }

  const scale = maxEdge / longestEdge;
  return image.resize({
    width: Math.max(Math.round(width * scale), 1),
    height: Math.max(Math.round(height * scale), 1),
  });
}

function optimizeQuickCaptureImage(image) {
  let working = constrainImageSize(image, QUICK_IMAGE_MAX_EDGE);
  let quality = 82;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const dataUrl = imageToJpegDataUrl(working, quality);
    if (dataUrl.length <= MAX_QUICK_IMAGE_DATA_URL_LENGTH) {
      return dataUrl;
    }

    if (quality > 50) {
      quality -= 12;
      continue;
    }

    const size = working.getSize();
    const longestEdge = Math.max(size.width || 1, size.height || 1);
    if (longestEdge <= QUICK_IMAGE_MIN_EDGE) {
      break;
    }

    working = constrainImageSize(working, Math.max(Math.round(longestEdge * 0.8), QUICK_IMAGE_MIN_EDGE));
    quality = 72;
  }

  return imageToJpegDataUrl(working, Math.max(quality, 40));
}

function setQuickModeEnabled(nextValue) {
  quickModeEnabled = Boolean(nextValue);
  if (!quickModeEnabled && overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }
  notifyQuickModeChanged();
}

function showMainWindow() {
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.show();
  mainWindow.focus();
}

function hideMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
  }
}

function ensureTray() {
  if (tray) {
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.setToolTip("ScreenExplain");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "메인 창 열기",
        click: () => {
          setQuickModeEnabled(false);
          showMainWindow();
        },
      },
      {
        label: "간편 캡처 시작",
        click: () => {
          setQuickModeEnabled(true);
          startQuickCapture().catch((error) => {
            dialog.showErrorBox("간편 답변 시작 실패", error.message || String(error));
          });
        },
      },
      {
        type: "separator",
      },
      {
        label: "종료",
        click: () => {
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", () => {
    setQuickModeEnabled(false);
    showMainWindow();
  });
}

async function startQuickCapture() {
  if (!quickModeEnabled) {
    setQuickModeEnabled(true);
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  activeQuickDisplay = display;

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close();
  }

  overlayWindow = createOverlayWindow(display);
  return { ok: true };
}

async function captureSelectionFromDisplay(selectionBounds) {
  if (!activeQuickDisplay) {
    throw new Error("활성 디스플레이를 찾지 못했습니다.");
  }

  const display = activeQuickDisplay;
  const scaleFactor = display.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.max(Math.round(display.bounds.width * scaleFactor), 1),
    height: Math.max(Math.round(display.bounds.height * scaleFactor), 1),
  };

  const sources = await getRawDisplaySources(["screen"], thumbnailSize);
  const source =
    sources.find((item) => String(display.id) === String(item.display_id)) ||
    sources.find((item) => item.id.startsWith("screen:")) ||
    sources[0];

  if (!source) {
    throw new Error("캡처할 화면 소스를 찾지 못했습니다.");
  }

  const cropBounds = {
    x: Math.max(Math.round(selectionBounds.x * scaleFactor), 0),
    y: Math.max(Math.round(selectionBounds.y * scaleFactor), 0),
    width: Math.max(Math.round(selectionBounds.width * scaleFactor), 1),
    height: Math.max(Math.round(selectionBounds.height * scaleFactor), 1),
  };

  const image = source.thumbnail.crop(cropBounds);
  if (image.isEmpty()) {
    throw new Error("선택한 영역을 캡처하지 못했습니다.");
  }

  return optimizeQuickCaptureImage(image);
}

async function analyzeQuickSelection(selectionBounds) {
  const imageDataUrl = await captureSelectionFromDisplay(selectionBounds);
  const response = await fetch(`http://127.0.0.1:${PORT}/api/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      mode: "quick",
      imageDataUrl,
      question: "선택한 영역이 문제 풀이, 시험, 수식, 선지일 수 있습니다. 핵심 답과 근거를 정확하게 짧게 설명해줘.",
      instruction: "간편 답변 모드입니다. 문제 풀이일 때는 계산과 선지 대조를 한 번 더 확인한 뒤 답하세요. 확실하지 않으면 추측하지 말고 불확실하다고 말하세요.",
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  notifyQuickAnswer({
    answer: data.answer,
    model: data.model,
    usage: data.usage,
    promptText: data.promptText,
    source: "quick",
  });

  return data;
}

function registerDisplayCapture() {
  session.defaultSession.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await getRawDisplaySources();
      if (!sources.length) {
        callback({});
        return;
      }

      const selectedSource = sources.find((source) => source.id === selectedSourceId);
      const primaryScreen = sources.find((source) => source.id.startsWith("screen:"));

      callback({
        video: selectedSource || primaryScreen || sources[0],
      });
    } catch (error) {
      console.error("Display capture setup failed:", error);
      callback({});
    }
  });
}

function createOverlayWindow(display) {
  const window = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    alwaysOnTop: true,
    fullscreenable: false,
    skipTaskbar: true,
    autoHideMenuBar: true,
    backgroundColor: "#00000000",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "overlay-preload.js"),
    },
  });

  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.loadFile(path.join(__dirname, "overlay.html"));
  window.on("closed", () => {
    if (overlayWindow === window) {
      overlayWindow = null;
      activeQuickDisplay = null;
    }
  });
  return window;
}

function registerIpcHandlers() {
  ipcMain.handle("screen-explain:list-sources", async () => listDisplaySources());
  ipcMain.handle("screen-explain:set-selected-source", async (_event, sourceId) => {
    selectedSourceId = sourceId || null;
    return { ok: true };
  });
  ipcMain.handle("screen-explain:get-quick-mode-state", async () => ({
    quickModeEnabled,
    captureShortcut: "Ctrl+Shift+S",
    showMainShortcut: "Ctrl+Shift+M",
    toggleShortcut: "Ctrl+Shift+Q",
  }));
  ipcMain.handle("screen-explain:enable-quick-mode", async () => {
    setQuickModeEnabled(true);
    hideMainWindow();
    return { ok: true, quickModeEnabled };
  });
  ipcMain.handle("screen-explain:disable-quick-mode", async () => {
    setQuickModeEnabled(false);
    showMainWindow();
    return { ok: true, quickModeEnabled };
  });
  ipcMain.handle("screen-explain:start-quick-capture", startQuickCapture);
  ipcMain.handle("screen-explain:open-external", async (_event, targetUrl) => {
    if (typeof targetUrl !== "string" || !targetUrl.trim()) {
      throw new Error("A URL is required.");
    }

    await shell.openExternal(targetUrl.trim());
    return { ok: true };
  });
  ipcMain.handle("screen-explain:overlay-cancel", async () => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.close();
    }
    return { ok: true };
  });
  ipcMain.handle("screen-explain:overlay-submit-selection", async (_event, selectionBounds) => {
    const result = await analyzeQuickSelection(selectionBounds);
    return result;
  });
}

function registerGlobalShortcuts() {
  globalShortcut.register(TOGGLE_QUICK_MODE_SHORTCUT, () => {
    if (quickModeEnabled) {
      setQuickModeEnabled(false);
      showMainWindow();
      return;
    }

    setQuickModeEnabled(true);
    hideMainWindow();
  });

  globalShortcut.register(QUICK_CAPTURE_SHORTCUT, () => {
    if (quickModeEnabled) {
      startQuickCapture().catch((error) => {
        dialog.showErrorBox("간편 답변 시작 실패", error.message || String(error));
      });
    }
  });

  globalShortcut.register(SHOW_MAIN_SHORTCUT, () => {
    setQuickModeEnabled(false);
    showMainWindow();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    title: "ScreenExplain",
    backgroundColor: "#08111d",
    autoHideMenuBar: true,
    icon: createTrayIcon(),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });
  mainWindow.on("close", (event) => {
    if (quickModeEnabled && !app.isQuiting) {
      event.preventDefault();
      hideMainWindow();
    }
  });
}

async function bootstrap() {
  try {
    ensureTray();
    registerDisplayCapture();
    registerIpcHandlers();
    registerGlobalShortcuts();
    localServer = await startServer(PORT);
    createWindow();
  } catch (error) {
    dialog.showErrorBox("ScreenExplain 시작 실패", error.message || String(error));
    app.quit();
  }
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (!quickModeEnabled && process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  showMainWindow();
});

app.on("before-quit", () => {
  app.isQuiting = true;
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (localServer) {
    localServer.close();
    localServer = null;
  }
});
