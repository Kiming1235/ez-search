const clearHistoryButton = document.getElementById("clearHistoryButton");
const saveModelButton = document.getElementById("saveModelButton");
const saveApiKeyButton = document.getElementById("saveApiKeyButton");
const testApiKeyButton = document.getElementById("testApiKeyButton");
const clearApiKeyButton = document.getElementById("clearApiKeyButton");
const savePromptButton = document.getElementById("savePromptButton");
const enableQuickModeButton = document.getElementById("enableQuickModeButton");
const startQuickCaptureButton = document.getElementById("startQuickCaptureButton");
const captionOverlay = document.getElementById("captionOverlay");
const modelSelect = document.getElementById("modelSelect");
const customModelInput = document.getElementById("customModelInput");
const savedPromptInput = document.getElementById("savedPromptInput");
const promptBadge = document.getElementById("promptBadge");
const promptHint = document.getElementById("promptHint");
const apiKeyInput = document.getElementById("apiKeyInput");
const apiKeyBadge = document.getElementById("apiKeyBadge");
const apiKeyHint = document.getElementById("apiKeyHint");
const modelBadge = document.getElementById("modelBadge");
const quickModeBadge = document.getElementById("quickModeBadge");
const quickModeHint = document.getElementById("quickModeHint");
const modelMeta = document.getElementById("modelMeta");
const usageModelName = document.getElementById("usageModelName");
const inputTokensValue = document.getElementById("inputTokensValue");
const outputTokensValue = document.getElementById("outputTokensValue");
const totalTokensValue = document.getElementById("totalTokensValue");
const remainingTokensValue = document.getElementById("remainingTokensValue");
const usageHint = document.getElementById("usageHint");
const historyList = document.getElementById("historyList");
const historyItemTemplate = document.getElementById("historyItemTemplate");
const serverStatus = document.getElementById("serverStatus");

let currentModel = "";
let supportedModels = [];
let quickModeEnabled = false;
let savedPrompt = "";

const history = [];
const desktopBridge = window.screenExplainDesktop || null;
const DEFAULT_PROMPT =
  "이 화면에서 사용자가 지금 바로 알아야 할 핵심 내용을 짧고 정확하게 설명해줘. 문제 풀이처럼 보이면 정답과 핵심 근거를 먼저 말해줘.";

function setPill(el, text, tone) {
  el.textContent = text;
  el.className = `pill ${tone}`;
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("ko-KR") : "-";
}

function getEffectivePrompt() {
  return savedPrompt && savedPrompt.trim() ? savedPrompt.trim() : DEFAULT_PROMPT;
}

function renderPromptState() {
  const customPrompt = savedPrompt && savedPrompt.trim();
  setPill(promptBadge, customPrompt ? "사용자 저장" : "기본값 사용", customPrompt ? "pill-ok" : "pill-idle");
  promptHint.textContent = customPrompt
    ? "저장한 프롬프트가 간편 모드 분석에 공통 적용됩니다."
    : "프롬프트가 비어 있어 기본 설명 프롬프트를 사용합니다.";
}

function renderUsage(usage = null, model = currentModel) {
  usageModelName.textContent = model || "미실행";
  usageModelName.className = `pill ${usage ? "pill-ok" : "pill-idle"}`;
  inputTokensValue.textContent = formatNumber(usage?.inputTokens);
  outputTokensValue.textContent = formatNumber(usage?.outputTokens);
  totalTokensValue.textContent = formatNumber(usage?.totalTokens);
  remainingTokensValue.textContent = formatNumber(usage?.remainingContextTokens);
  usageHint.textContent = usage?.remainingContextTokens == null
    ? "현재 모델의 컨텍스트 윈도우 정보를 알 수 없어 남은 토큰 추정을 표시하지 못합니다."
    : "남은 컨텍스트는 현재 호출 기준 추정치입니다.";
}

function renderApiKeyState(data) {
  const configured = Boolean(data?.apiKeyConfigured);
  setPill(apiKeyBadge, configured ? "연결됨" : "미설정", configured ? "pill-ok" : "pill-idle");
  apiKeyHint.textContent = configured
    ? `저장된 키: ${data.apiKeyMasked}`
    : "키는 현재 Windows 사용자 기준으로 로컬에 암호화 저장됩니다.";
  if (configured) {
    apiKeyInput.value = "";
  }
}

function renderQuickModeState(payload) {
  quickModeEnabled = Boolean(payload?.quickModeEnabled);
  setPill(quickModeBadge, quickModeEnabled ? "켜짐" : "꺼짐", quickModeEnabled ? "pill-ok" : "pill-idle");
  enableQuickModeButton.textContent = quickModeEnabled ? "간편 모드 끄기" : "간편 모드 켜기";
  quickModeHint.textContent = quickModeEnabled
    ? `간편 모드 활성화됨. ${payload.showMainShortcut}로 메인 창 복귀, ${payload.captureShortcut}로 즉시 드래그 분석`
    : "드래그한 영역을 기준으로 짧은 설명을 말풍선처럼 표시합니다.";
}

function populateModelSelect(models, activeModel) {
  supportedModels = models;
  modelSelect.innerHTML = "";

  const modelNames = new Set(models.map((model) => model.id));
  if (activeModel && !modelNames.has(activeModel)) {
    const option = document.createElement("option");
    option.value = activeModel;
    option.textContent = `${activeModel} (현재 사용자 지정)`;
    modelSelect.appendChild(option);
  }

  for (const model of models) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.label} · ${model.contextWindow.toLocaleString("ko-KR")} ctx`;
    modelSelect.appendChild(option);
  }

  modelSelect.value = activeModel;
  customModelInput.value = activeModel;
  currentModel = activeModel;
  updateModelMeta();
}

function updateModelMeta() {
  const chosenId = customModelInput.value.trim() || modelSelect.value;
  const chosenModel = supportedModels.find((model) => model.id === chosenId);

  if (!chosenModel) {
    modelMeta.textContent = "사용자 지정 모델 ID를 적용합니다.";
    return;
  }

  modelMeta.textContent =
    `컨텍스트 ${chosenModel.contextWindow.toLocaleString("ko-KR")} · 최대 출력 ${chosenModel.maxOutputTokens.toLocaleString("ko-KR")}`;
}

function addHistory(answer, metaText, promptText = getEffectivePrompt()) {
  history.unshift({
    answer,
    metaText,
    promptText,
    createdAt: new Date(),
  });

  history.splice(8);
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = "";

  for (const item of history) {
    const node = historyItemTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector(".history-question").textContent = `Prompt. ${item.promptText}`;
    node.querySelector(".history-answer").textContent = item.answer;
    node.querySelector(".history-meta").textContent = item.metaText || "";
    node.querySelector(".history-time").textContent = item.createdAt.toLocaleTimeString("ko-KR");
    historyList.appendChild(node);
  }
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  populateModelSelect(data.supportedModels || [], data.model || "");
  savedPrompt = data.savedPrompt || "";
  savedPromptInput.value = savedPrompt;
  renderPromptState();
  renderApiKeyState(data);
  setPill(modelBadge, data.model || "미설정", "pill-ok");
  setPill(
    serverStatus,
    data.apiKeyConfigured ? "서버 준비 완료" : "OpenAI API 키 필요",
    data.apiKeyConfigured ? "pill-ok" : "pill-warn",
  );
}

async function checkServer() {
  try {
    await loadSettings();
  } catch {
    setPill(serverStatus, "서버 연결 실패", "pill-error");
  }
}

async function syncQuickModeState() {
  if (!desktopBridge?.getQuickModeState) {
    return;
  }

  const state = await desktopBridge.getQuickModeState();
  renderQuickModeState(state);
}

async function saveModel() {
  const nextModel = customModelInput.value.trim() || modelSelect.value;
  if (!nextModel) {
    return;
  }

  saveModelButton.disabled = true;
  modelMeta.textContent = "모델을 적용하는 중입니다...";

  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: nextModel }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    currentModel = data.model;
    customModelInput.value = data.model;
    if ([...modelSelect.options].some((option) => option.value === data.model)) {
      modelSelect.value = data.model;
    }
    savedPrompt = data.savedPrompt || savedPrompt;
    renderPromptState();
    renderApiKeyState(data);
    setPill(modelBadge, data.model, "pill-ok");
    updateModelMeta();
  } catch (error) {
    modelMeta.textContent = error.message;
  } finally {
    saveModelButton.disabled = false;
  }
}

async function savePrompt() {
  const nextPrompt = savedPromptInput.value.trim();
  savePromptButton.disabled = true;
  promptHint.textContent = "분석 프롬프트를 저장하는 중입니다...";

  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ savedPrompt: nextPrompt || DEFAULT_PROMPT }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    savedPrompt = nextPrompt || DEFAULT_PROMPT;
    savedPromptInput.value = nextPrompt;
    renderPromptState();
    promptHint.textContent = "저장되었습니다. 이후 간편 모드 캡처는 이 프롬프트를 사용합니다.";
    renderApiKeyState(data);
  } catch (error) {
    promptHint.textContent = error.message;
  } finally {
    savePromptButton.disabled = false;
  }
}

async function saveApiKey() {
  const nextApiKey = apiKeyInput.value.trim();
  if (!nextApiKey) {
    apiKeyHint.textContent = "저장할 OpenAI API 키를 입력해 주세요.";
    return;
  }

  saveApiKeyButton.disabled = true;
  apiKeyHint.textContent = "API 키를 저장하는 중입니다...";

  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: nextApiKey }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    renderApiKeyState(data);
    setPill(
      serverStatus,
      data.apiKeyConfigured ? "서버 준비 완료" : "OpenAI API 키 필요",
      data.apiKeyConfigured ? "pill-ok" : "pill-warn",
    );
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    saveApiKeyButton.disabled = false;
  }
}

async function testApiKey() {
  testApiKeyButton.disabled = true;
  apiKeyHint.textContent = "OpenAI 연결을 확인하는 중입니다...";

  try {
    const response = await fetch("/api/test-auth", { method: "POST" });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    apiKeyHint.textContent = "OpenAI 연결이 정상입니다.";
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    testApiKeyButton.disabled = false;
  }
}

async function clearApiKey() {
  clearApiKeyButton.disabled = true;
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearApiKey: true }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    renderApiKeyState(data);
    setPill(serverStatus, "OpenAI API 키 필요", "pill-warn");
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    clearApiKeyButton.disabled = false;
  }
}

async function toggleQuickMode() {
  if (!desktopBridge) {
    return;
  }

  if (quickModeEnabled) {
    const result = await desktopBridge.disableQuickMode();
    renderQuickModeState(result);
    return;
  }

  const result = await desktopBridge.enableQuickMode();
  renderQuickModeState(result);
}

async function triggerQuickCapture() {
  if (!desktopBridge?.startQuickCapture) {
    return;
  }

  await desktopBridge.startQuickCapture();
}

clearHistoryButton.addEventListener("click", () => {
  history.length = 0;
  renderHistory();
});
saveModelButton.addEventListener("click", saveModel);
saveApiKeyButton.addEventListener("click", saveApiKey);
testApiKeyButton.addEventListener("click", testApiKey);
clearApiKeyButton.addEventListener("click", clearApiKey);
savePromptButton.addEventListener("click", savePrompt);
enableQuickModeButton.addEventListener("click", () => {
  toggleQuickMode().catch((error) => {
    quickModeHint.textContent = error.message;
  });
});
startQuickCaptureButton.addEventListener("click", () => {
  triggerQuickCapture().catch((error) => {
    quickModeHint.textContent = error.message;
  });
});
modelSelect.addEventListener("change", () => {
  customModelInput.value = modelSelect.value;
  updateModelMeta();
});
customModelInput.addEventListener("input", updateModelMeta);
savedPromptInput.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    savePrompt();
  }
});

renderUsage();
renderPromptState();
checkServer();
syncQuickModeState();

if (desktopBridge?.onQuickModeChanged) {
  desktopBridge.onQuickModeChanged(renderQuickModeState);
}

if (desktopBridge?.onQuickAnswer) {
  desktopBridge.onQuickAnswer((payload) => {
    const metaText = payload?.usage
      ? `quick · ${payload.model} · 입력 ${formatNumber(payload.usage.inputTokens)} · 출력 ${formatNumber(payload.usage.outputTokens)}`
      : `quick · ${payload?.model || currentModel}`;
    addHistory(payload?.answer || "", metaText, payload?.promptText || getEffectivePrompt());
    if (payload?.usage) {
      renderUsage(payload.usage, payload.model || currentModel);
    }
    captionOverlay.textContent = payload?.answer || "간편 모드 답변이 기록되었습니다.";
  });
}
