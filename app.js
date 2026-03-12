const clearHistoryButton = document.getElementById("clearHistoryButton");
const saveModelButton = document.getElementById("saveModelButton");
const saveApiKeyButton = document.getElementById("saveApiKeyButton");
const testApiKeyButton = document.getElementById("testApiKeyButton");
const clearApiKeyButton = document.getElementById("clearApiKeyButton");
const savePromptButton = document.getElementById("savePromptButton");
const enableQuickModeButton = document.getElementById("enableQuickModeButton");
const startQuickCaptureButton = document.getElementById("startQuickCaptureButton");
const apiKeyInput = document.getElementById("apiKeyInput");
const remoteApiUrlInput = document.getElementById("remoteApiUrlInput");
const remoteApiTokenInput = document.getElementById("remoteApiTokenInput");
const saveRemoteApiButton = document.getElementById("saveRemoteApiButton");
const clearRemoteApiButton = document.getElementById("clearRemoteApiButton");
const requestNameInput = document.getElementById("requestNameInput");
const requestEmailInput = document.getElementById("requestEmailInput");
const requestNoteInput = document.getElementById("requestNoteInput");
const requestAccessButton = document.getElementById("requestAccessButton");
const checkRequestStatusButton = document.getElementById("checkRequestStatusButton");
const logoutRemoteAuthButton = document.getElementById("logoutRemoteAuthButton");
const modelSelect = document.getElementById("modelSelect");
const customModelInput = document.getElementById("customModelInput");
const savedPromptInput = document.getElementById("savedPromptInput");
const promptBadge = document.getElementById("promptBadge");
const promptHint = document.getElementById("promptHint");
const apiKeyBadge = document.getElementById("apiKeyBadge");
const apiKeyHint = document.getElementById("apiKeyHint");
const remoteAuthBadge = document.getElementById("remoteAuthBadge");
const remoteAuthHint = document.getElementById("remoteAuthHint");
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
const historySearchInput = document.getElementById("historySearchInput");
const historyList = document.getElementById("historyList");
const historyItemTemplate = document.getElementById("historyItemTemplate");
const serverStatus = document.getElementById("serverStatus");
const answerFormatter = window.ScreenExplainAnswerFormat;

let currentModel = "";
let supportedModels = [];
let quickModeEnabled = false;
let savedPrompt = "";
let backendMode = "openai";
let remoteTokenKind = "";
let remoteAuthUser = null;
let remoteAuthExpiresAt = "";
let remoteApprovalRequest = null;

const history = [];
const desktopBridge = window.screenExplainDesktop || null;

function setPill(element, text, tone) {
  element.textContent = text;
  element.className = `pill ${tone}`;
}

function formatNumber(value) {
  return typeof value === "number" ? value.toLocaleString("ko-KR") : "-";
}

function formatDateTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toLocaleString("ko-KR");
}

function createHistoryId() {
  return `history-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function getCustomPrompt() {
  return savedPrompt && savedPrompt.trim() ? savedPrompt.trim() : "";
}

function getHistorySearchTerm() {
  return historySearchInput?.value.trim().toLowerCase() || "";
}

function sanitizeHistoryForSave() {
  return history.slice(0, 30).map((item) => ({
    id: item.id,
    answer: item.answer,
    metaText: item.metaText,
    promptText: item.promptText,
    pinned: item.pinned === true,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : new Date().toISOString(),
  }));
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function persistHistory() {
  return postJson("/api/settings", { recentHistory: sanitizeHistoryForSave() });
}

function renderPromptState() {
  const customPrompt = getCustomPrompt();
  setPill(promptBadge, customPrompt ? "사용자 프롬프트" : "기본값", customPrompt ? "pill-ok" : "pill-idle");
  promptHint.textContent = customPrompt
    ? "지금 저장된 사용자 프롬프트가 캡처 분석에 사용됩니다."
    : "입력칸이 비어 있으면 내장 기본 프롬프트를 사용합니다.";
}

function renderUsage(usage = null, model = currentModel) {
  usageModelName.textContent = model || "미설정";
  usageModelName.className = `pill ${usage ? "pill-ok" : "pill-idle"}`;
  inputTokensValue.textContent = formatNumber(usage?.inputTokens);
  outputTokensValue.textContent = formatNumber(usage?.outputTokens);
  totalTokensValue.textContent = formatNumber(usage?.totalTokens);
  remainingTokensValue.textContent = formatNumber(usage?.remainingContextTokens);
  usageHint.textContent = usage?.remainingContextTokens == null
    ? "최근 응답의 사용량이 아직 없습니다."
    : "최근 응답 기준 토큰 사용량입니다.";
}

function normalizeApprovalRequest(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  const requestId = typeof data.requestId === "string" ? data.requestId.trim() : "";
  const email = typeof data.email === "string" ? data.email.trim() : "";
  if (!requestId || !email) {
    return null;
  }

  return {
    requestId,
    email,
    name: typeof data.name === "string" ? data.name.trim() : "",
    note: typeof data.note === "string" ? data.note.trim() : "",
    deviceLabel: typeof data.deviceLabel === "string" ? data.deviceLabel.trim() : "",
    status: typeof data.status === "string" ? data.status.trim() : "pending",
    requestedAt: typeof data.requestedAt === "string" ? data.requestedAt.trim() : "",
    updatedAt: typeof data.updatedAt === "string" ? data.updatedAt.trim() : "",
  };
}

function syncApprovalForm() {
  if (!remoteApprovalRequest) {
    return;
  }

  requestNameInput.value = remoteApprovalRequest.name || "";
  requestEmailInput.value = remoteApprovalRequest.email || "";
  requestNoteInput.value = remoteApprovalRequest.note || "";
}

function renderRemoteAuthState(data) {
  remoteTokenKind = data?.remoteTokenKind || "";
  remoteAuthUser = data?.remoteAuthUser || null;
  remoteAuthExpiresAt = data?.remoteAuthExpiresAt || "";
  remoteApprovalRequest = normalizeApprovalRequest(data?.remoteApprovalRequest);

  const remoteUrlConfigured = Boolean(data?.remoteApiUrlConfigured || data?.remoteApiUrl);
  const hasApprovalRequest = Boolean(remoteApprovalRequest?.requestId);

  syncApprovalForm();

  requestAccessButton.disabled = !remoteUrlConfigured;
  checkRequestStatusButton.disabled = !remoteUrlConfigured || !hasApprovalRequest;
  logoutRemoteAuthButton.disabled = !remoteTokenKind && !hasApprovalRequest;

  if (!remoteUrlConfigured) {
    setPill(remoteAuthBadge, "URL 필요", "pill-idle");
    remoteAuthHint.textContent = "원격 API URL을 먼저 저장해야 승인 요청을 보낼 수 있습니다.";
    return;
  }

  if (remoteTokenKind === "user-session" && remoteAuthUser?.email) {
    setPill(remoteAuthBadge, "승인됨", "pill-ok");
    const bits = [];
    if (remoteAuthUser.name) {
      bits.push(remoteAuthUser.name);
    }
    bits.push(remoteAuthUser.email);
    if (remoteAuthExpiresAt) {
      bits.push(`만료 ${formatDateTime(remoteAuthExpiresAt)}`);
    }
    remoteAuthHint.textContent = bits.join(" / ");
    return;
  }

  if (remoteTokenKind === "legacy") {
    setPill(remoteAuthBadge, "레거시 토큰", "pill-warn");
    remoteAuthHint.textContent = "공통 토큰 방식입니다. 새 배포는 승인 요청 방식 사용을 권장합니다.";
    return;
  }

  if (hasApprovalRequest) {
    if (remoteApprovalRequest.status === "approved") {
      setPill(remoteAuthBadge, "승인 완료", "pill-ok");
      remoteAuthHint.textContent = "승인된 기기입니다. 상태 확인을 누르면 세션을 다시 발급받습니다.";
      return;
    }

    if (remoteApprovalRequest.status === "blocked") {
      setPill(remoteAuthBadge, "차단됨", "pill-error");
      remoteAuthHint.textContent = "이 요청은 현재 차단 상태입니다. 관리자에게 확인하십시오.";
      return;
    }

    setPill(remoteAuthBadge, "승인 대기", "pill-warn");
    remoteAuthHint.textContent = "승인 요청이 접수되었습니다. 관리자가 승인하면 상태 확인 후 바로 사용할 수 있습니다.";
    return;
  }

  setPill(remoteAuthBadge, "요청 없음", "pill-idle");
  remoteAuthHint.textContent = "이 앱에서 이름과 이메일을 입력해 승인 요청을 보내면 됩니다.";
}

function renderConnectionState(data) {
  const remoteConfigured = Boolean(data?.remoteApiConfigured);
  const localConfigured = Boolean(data?.apiKeyConfigured);
  backendMode = data?.backendMode || (remoteConfigured ? "remote" : "openai");

  if (backendMode === "remote") {
    setPill(apiKeyBadge, "원격 API", "pill-ok");
  } else if (localConfigured) {
    setPill(apiKeyBadge, "OpenAI 직접", "pill-ok");
  } else {
    setPill(apiKeyBadge, "미설정", "pill-idle");
  }

  const bits = [];
  if (data?.remoteApiUrl) {
    bits.push(`원격 URL: ${data.remoteApiUrl}`);
  }
  if (data?.remoteApiTokenMasked) {
    bits.push(`원격 토큰: ${data.remoteApiTokenMasked}`);
  }
  if (localConfigured) {
    bits.push(`OpenAI 키: ${data.apiKeyMasked}`);
  } else {
    bits.push("OpenAI 키 없음");
  }

  apiKeyHint.textContent = bits.join(" / ");
  apiKeyInput.value = "";
  remoteApiUrlInput.value = data?.remoteApiUrl || "";
  remoteApiTokenInput.value = "";
  renderRemoteAuthState(data);
}

function renderQuickModeState(payload) {
  quickModeEnabled = Boolean(payload?.quickModeEnabled);
  setPill(quickModeBadge, quickModeEnabled ? "활성" : "비활성", quickModeEnabled ? "pill-ok" : "pill-idle");
  enableQuickModeButton.textContent = quickModeEnabled ? "간편 모드 끄기" : "간편 모드 켜기";
  quickModeHint.textContent = "";
}

function renderServerState(data) {
  if (data?.backendMode === "remote") {
    setPill(serverStatus, "원격 API", "pill-ok");
    return;
  }

  if (data?.remoteApiUrlConfigured) {
    setPill(serverStatus, "승인 필요", "pill-warn");
    return;
  }

  if (data?.apiKeyConfigured) {
    setPill(serverStatus, "OpenAI 직접", "pill-ok");
    return;
  }

  setPill(serverStatus, "설정 필요", "pill-warn");
}

function populateModelSelect(models, activeModel) {
  supportedModels = Array.isArray(models) ? models : [];
  modelSelect.innerHTML = "";

  const knownIds = new Set(supportedModels.map((model) => model.id));
  if (activeModel && !knownIds.has(activeModel)) {
    const option = document.createElement("option");
    option.value = activeModel;
    option.textContent = `${activeModel} (사용 중)`;
    modelSelect.appendChild(option);
  }

  for (const model of supportedModels) {
    const option = document.createElement("option");
    option.value = model.id;
    const contextText = typeof model.contextWindow === "number"
      ? ` / ctx ${model.contextWindow.toLocaleString("ko-KR")}`
      : model.ownedBy
        ? ` / ${model.ownedBy}`
        : "";
    option.textContent = `${model.label || model.id}${contextText}`;
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
    modelMeta.textContent = "직접 입력한 모델 ID를 사용합니다.";
    return;
  }

  const parts = [];
  if (typeof chosenModel.contextWindow === "number") {
    parts.push(`컨텍스트 ${chosenModel.contextWindow.toLocaleString("ko-KR")}`);
  }
  if (typeof chosenModel.maxOutputTokens === "number") {
    parts.push(`최대 출력 ${chosenModel.maxOutputTokens.toLocaleString("ko-KR")}`);
  }
  if (chosenModel.ownedBy) {
    parts.push(`소유자 ${chosenModel.ownedBy}`);
  }

  modelMeta.textContent = parts.length
    ? parts.join(" / ")
    : "OpenAI API가 제공한 모델 정보가 제한적입니다.";
}

function loadHistory(items = []) {
  history.length = 0;

  for (const item of items) {
    history.push({
      id: item.id || createHistoryId(),
      answer: item.answer || "",
      metaText: item.metaText || "",
      promptText: item.promptText || "",
      pinned: item.pinned === true,
      createdAt: item.createdAt ? new Date(item.createdAt) : new Date(),
    });
  }

  renderHistory();
}

function buildHistoryPromptLabel(item) {
  return item.promptText ? `사용자 프롬프트: ${item.promptText}` : "프롬프트: 기본값";
}

function addHistory(answer, metaText, promptText = getCustomPrompt()) {
  history.unshift({
    id: createHistoryId(),
    answer,
    metaText,
    promptText,
    pinned: false,
    createdAt: new Date(),
  });

  history.splice(30);
  renderHistory();
  persistHistory().catch((error) => {
    quickModeHint.textContent = error.message;
  });
}

function togglePinHistoryItem(historyId) {
  const item = history.find((entry) => entry.id === historyId);
  if (!item) {
    return;
  }

  item.pinned = !item.pinned;
  renderHistory();
  persistHistory().catch((error) => {
    quickModeHint.textContent = error.message;
  });
}

function renderHistory() {
  historyList.innerHTML = "";

  const searchTerm = getHistorySearchTerm();
  const items = [...history]
    .sort((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }
      return right.createdAt - left.createdAt;
    })
    .filter((item) => {
      if (!searchTerm) {
        return true;
      }

      const haystack = [buildHistoryPromptLabel(item), item.answer, item.metaText].join(" ").toLowerCase();
      return haystack.includes(searchTerm);
    });

  if (!items.length) {
    const emptyState = document.createElement("li");
    emptyState.className = "history-empty";
    emptyState.textContent = searchTerm ? "검색 결과가 없습니다." : "최근 답변이 없습니다.";
    historyList.appendChild(emptyState);
    return;
  }

  for (const item of items) {
    const node = historyItemTemplate.content.firstElementChild.cloneNode(true);
    const historyPrompt = node.querySelector(".history-question");
    historyPrompt.textContent = buildHistoryPromptLabel(item);
    historyPrompt.hidden = false;

    const historyAnswer = node.querySelector(".history-answer");
    if (answerFormatter) {
      historyAnswer.innerHTML = answerFormatter.renderAnswerHtml(item.answer);
    } else {
      historyAnswer.textContent = item.answer;
    }

    node.querySelector(".history-meta").textContent = item.metaText || "";
    node.querySelector(".history-time").textContent = item.createdAt.toLocaleTimeString("ko-KR");

    const pinButton = node.querySelector(".history-pin");
    pinButton.textContent = item.pinned ? "고정 해제" : "고정";
    pinButton.addEventListener("click", () => {
      togglePinHistoryItem(item.id);
    });

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
  savedPrompt = data.customPrompt || "";
  savedPromptInput.value = savedPrompt;
  loadHistory(data.recentHistory || []);
  renderPromptState();
  renderConnectionState(data);
  setPill(modelBadge, data.model || "미설정", "pill-ok");
  renderServerState(data);
  return data;
}

async function maybeRefreshApprovalStatus(data) {
  if (!data?.remoteApprovalRequest || data?.remoteTokenKind || !data?.remoteApiUrlConfigured) {
    return;
  }

  try {
    const next = await postJson("/api/auth/check-status", {});
    renderConnectionState(next);
    renderServerState(next);
  } catch {
    // Silent on initial load. The user can retry manually.
  }
}

async function checkServer() {
  try {
    const data = await loadSettings();
    await maybeRefreshApprovalStatus(data);
  } catch {
    setPill(serverStatus, "서버 오류", "pill-error");
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
  modelMeta.textContent = "모델 저장 중...";

  try {
    const data = await postJson("/api/settings", { model: nextModel });
    currentModel = data.model;
    customModelInput.value = data.model;
    if ([...modelSelect.options].some((option) => option.value === data.model)) {
      modelSelect.value = data.model;
    }
    savedPrompt = data.customPrompt || "";
    savedPromptInput.value = savedPrompt;
    renderPromptState();
    renderConnectionState(data);
    setPill(modelBadge, data.model, "pill-ok");
    renderServerState(data);
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
  promptHint.textContent = "프롬프트 저장 중...";

  try {
    const data = await postJson("/api/settings", { savedPrompt: nextPrompt });
    savedPrompt = data.customPrompt || "";
    savedPromptInput.value = savedPrompt;
    renderPromptState();
    promptHint.textContent = savedPrompt
      ? "사용자 프롬프트를 저장했습니다."
      : "입력값을 비워 기본 프롬프트로 되돌렸습니다.";
    renderConnectionState(data);
    renderServerState(data);
  } catch (error) {
    promptHint.textContent = error.message;
  } finally {
    savePromptButton.disabled = false;
  }
}

async function saveApiKey() {
  const nextApiKey = apiKeyInput.value.trim();
  if (!nextApiKey) {
    apiKeyHint.textContent = "OpenAI API 키를 입력하십시오.";
    return;
  }

  saveApiKeyButton.disabled = true;
  apiKeyHint.textContent = "API 키 저장 중...";

  try {
    const data = await postJson("/api/settings", { apiKey: nextApiKey });
    renderConnectionState(data);
    renderServerState(data);
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    saveApiKeyButton.disabled = false;
  }
}

async function testApiKey() {
  testApiKeyButton.disabled = true;
  apiKeyHint.textContent = "연결 확인 중...";

  try {
    const response = await fetch("/api/test-auth", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    if (String(data.backendMode || "").startsWith("remote")) {
      const settings = await loadSettings();
      renderConnectionState(settings);
      renderServerState(settings);
    }

    apiKeyHint.textContent = data.backendMode === "remote"
      ? "원격 API 연결이 정상입니다."
      : data.backendMode === "remote-pending"
        ? "원격 URL은 정상입니다. 현재 기기는 승인 대기 또는 세션 발급 전 상태입니다."
        : data.backendMode === "remote-ready"
          ? "원격 URL은 정상입니다. 승인 요청 또는 토큰 입력이 필요합니다."
          : "OpenAI API 연결이 정상입니다.";
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    testApiKeyButton.disabled = false;
  }
}

async function clearApiKey() {
  clearApiKeyButton.disabled = true;
  try {
    const data = await postJson("/api/settings", { clearApiKey: true });
    renderConnectionState(data);
    renderServerState(data);
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    clearApiKeyButton.disabled = false;
  }
}

async function saveRemoteApi() {
  const remoteApiUrl = remoteApiUrlInput.value.trim();
  const remoteApiToken = remoteApiTokenInput.value.trim();

  if (!remoteApiUrl) {
    apiKeyHint.textContent = "원격 API URL을 입력하십시오.";
    return;
  }

  saveRemoteApiButton.disabled = true;
  apiKeyHint.textContent = "원격 API 저장 중...";

  try {
    const body = { remoteApiUrl };
    if (remoteApiToken) {
      body.remoteApiToken = remoteApiToken;
    }

    const data = await postJson("/api/settings", body);
    renderConnectionState(data);
    renderServerState(data);
    apiKeyHint.textContent = remoteApiToken
      ? "원격 URL과 레거시 토큰을 저장했습니다."
      : "원격 URL을 저장했습니다. 이제 승인 요청을 보낼 수 있습니다.";
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    saveRemoteApiButton.disabled = false;
  }
}

async function clearRemoteApi() {
  clearRemoteApiButton.disabled = true;

  try {
    const data = await postJson("/api/settings", {
      remoteApiUrl: "",
      clearRemoteApiToken: true,
    });

    renderConnectionState(data);
    renderServerState(data);
    apiKeyHint.textContent = "원격 API 설정을 지웠습니다.";
  } catch (error) {
    apiKeyHint.textContent = error.message;
  } finally {
    clearRemoteApiButton.disabled = false;
  }
}

async function submitAccessRequest() {
  const name = requestNameInput.value.trim();
  const email = requestEmailInput.value.trim();
  const note = requestNoteInput.value.trim();

  if (!email) {
    remoteAuthHint.textContent = "이메일은 필수입니다.";
    return;
  }

  requestAccessButton.disabled = true;
  remoteAuthHint.textContent = "승인 요청 전송 중...";

  try {
    const data = await postJson("/api/auth/request-access", { name, email, note });
    renderConnectionState(data);
    renderServerState(data);
    remoteAuthHint.textContent = data.requestStatus === "approved"
      ? "이미 승인된 기기입니다. 상태 확인 후 바로 사용할 수 있습니다."
      : "승인 요청을 보냈습니다. 관리자가 승인하면 상태 확인 후 바로 사용 가능합니다.";
  } catch (error) {
    remoteAuthHint.textContent = error.message;
  } finally {
    requestAccessButton.disabled = false;
  }
}

async function checkApprovalStatus() {
  checkRequestStatusButton.disabled = true;
  remoteAuthHint.textContent = "승인 상태 확인 중...";

  try {
    const data = await postJson("/api/auth/check-status", {});
    renderConnectionState(data);
    renderServerState(data);

    if (data.remoteTokenKind === "user-session") {
      remoteAuthHint.textContent = "승인이 확인되어 바로 사용할 수 있습니다.";
    } else if (data.requestStatus === "blocked") {
      remoteAuthHint.textContent = "이 요청은 현재 차단 상태입니다.";
    } else {
      remoteAuthHint.textContent = "아직 승인 대기 중입니다.";
    }
  } catch (error) {
    remoteAuthHint.textContent = error.message;
  } finally {
    checkRequestStatusButton.disabled = false;
  }
}

async function logoutRemoteAuth() {
  logoutRemoteAuthButton.disabled = true;

  try {
    const data = await postJson("/api/auth/logout", {});
    renderConnectionState(data);
    renderServerState(data);
    remoteAuthHint.textContent = "로컬 승인 정보와 세션을 정리했습니다.";
  } catch (error) {
    remoteAuthHint.textContent = error.message;
  } finally {
    logoutRemoteAuthButton.disabled = false;
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
  persistHistory().catch((error) => {
    quickModeHint.textContent = error.message;
  });
});

saveModelButton.addEventListener("click", saveModel);
saveApiKeyButton.addEventListener("click", saveApiKey);
testApiKeyButton.addEventListener("click", testApiKey);
clearApiKeyButton.addEventListener("click", clearApiKey);
saveRemoteApiButton.addEventListener("click", saveRemoteApi);
clearRemoteApiButton.addEventListener("click", clearRemoteApi);
requestAccessButton.addEventListener("click", () => {
  submitAccessRequest().catch((error) => {
    remoteAuthHint.textContent = error.message;
  });
});
checkRequestStatusButton.addEventListener("click", () => {
  checkApprovalStatus().catch((error) => {
    remoteAuthHint.textContent = error.message;
  });
});
logoutRemoteAuthButton.addEventListener("click", () => {
  logoutRemoteAuth().catch((error) => {
    remoteAuthHint.textContent = error.message;
  });
});
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
historySearchInput?.addEventListener("input", renderHistory);
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
      ? `간편모드 / ${payload.model} / 입력 ${formatNumber(payload.usage.inputTokens)} / 출력 ${formatNumber(payload.usage.outputTokens)}`
      : `간편모드 / ${payload?.model || currentModel}`;
    addHistory(
      payload?.answer || "",
      metaText,
      payload?.promptText || getCustomPrompt(),
    );
    if (payload?.usage) {
      renderUsage(payload.usage, payload.model || currentModel);
    }
    quickModeHint.textContent = "";
  });
}
