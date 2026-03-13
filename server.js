const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const {
  clearApiKey,
  clearRemoteApiToken,
  clearRemoteRequestToken,
  loadApiKey,
  loadRemoteApiToken,
  loadRemoteRequestToken,
  saveApiKey,
  saveRemoteApiToken,
  saveRemoteRequestToken,
} = require("./secure-store");
const { loadSettings, saveSettings } = require("./settings-store");

const PORT = process.env.PORT || 4174;
const ROOT = __dirname;
const persistedSettings = loadSettings();

const LEGACY_ENGLISH_DEFAULT_PROMPT = [
  "Understand the visible content before answering.",
  "Respond in the same language as the visible text when possible; otherwise use the user's language.",
  "Prioritize correctness over speed, but stay concise.",
  "If the screen looks like a question, form, chart, table, notice, or error message, identify that first.",
  "If the answer is uncertain because the image is blurry or incomplete, say what is missing instead of guessing.",
  "For practical tasks, give the answer first and then the shortest useful reason or next step.",
  "Protect sensitive information by summarizing rather than repeating secrets or personal data.",
].join(" ");

const LEGACY_KOREAN_DEFAULT_PROMPT = [
  "답변 전에 화면에 보이는 내용을 먼저 정확히 파악합니다.",
  "가능하면 화면의 언어와 같은 언어로 답하고, 불명확하면 사용자 언어인 한국어로 답합니다.",
  "장황하게 쓰지 말고 정확성과 실용성을 우선합니다.",
  "질문, 표, 차트, 공지, 오류창, 양식처럼 보이면 먼저 그 성격을 짚고 답합니다.",
  "이미지가 흐리거나 잘려 있어 확실하지 않으면 추측하지 말고 무엇이 부족한지 말합니다.",
  "실용적인 요청은 정답이나 핵심 결론을 먼저 말하고, 필요한 이유나 다음 단계만 짧게 덧붙입니다.",
  "수식, 계산, 단위, 비교를 설명할 때는 가독성이 좋아지면 √, ×, →, %, kW 같은 특수문자와 표기를 적극 활용합니다.",
  "분수나 루트 같은 정식 수식 표기가 유리하면 $\\frac{a}{b}$, $\\sqrt{x}$처럼 LaTeX 스타일 표기를 사용해도 됩니다.",
  "민감한 정보는 그대로 반복하지 말고 요약해서 다룹니다.",
].join(" ");

const KOREAN_DEFAULT_PROMPT = [
  "답변 전에 이미지에 보이는 내용을 먼저 정확히 파악합니다.",
  "기본 원칙:",
  "- 가능하면 화면의 언어와 같은 언어로 답하고, 불명확하면 사용자 언어인 한국어로 답합니다.",
  "- 장황하게 쓰지 말고 정확성과 실용성을 우선합니다.",
  "- 이미지가 흐리거나 잘렸거나 일부 정보가 가려져 있으면 추측하지 말고, 무엇이 부족한지 분명히 말합니다.",
  "- 민감한 정보는 그대로 반복하지 말고 요약해서 다룹니다.",
  "이미지 해석 절차:",
  "1. 먼저 화면의 성격을 짧게 판별합니다.",
  "- 예: 문제, 표, 그래프, 차트, 공지, 오류창, 양식, 대화, 문서, 코드, 설정 화면",
  "2. 문제처럼 보이면 먼저 다음을 정리합니다.",
  "- 무엇을 묻는지",
  "- 주어진 조건",
  "- 보기 유무",
  "- 숫자, 단위, 수식, 제한조건",
  "3. 계산/개념 문제이면 바로 결론을 내리지 말고, 적용할 개념이나 공식을 먼저 점검합니다.",
  "4. 비슷한 개념과 혼동 가능성이 있으면 먼저 구분합니다.",
  "5. 답을 낸 뒤에는 단위, 부호, 보기 일치 여부, 조건 누락 여부를 짧게 검산합니다.",
  "출력 원칙:",
  "- 실용적인 요청은 정답이나 핵심 결론을 먼저 말하고, 필요한 이유만 짧게 덧붙입니다.",
  "- 객관식 문제이면 가능한 경우 정답 번호를 먼저 제시하고, 근거를 짧게 설명합니다.",
  "- 서술형 문제이면 핵심 개념 → 이유 → 결론 순서로 짧게 답합니다.",
  "- 계산 문제이면 사용한 식, 핵심 계산, 최종값을 순서대로 제시합니다.",
  "- 표/그래프 문제이면 먼저 축, 항목, 추세, 비교 대상을 확인한 뒤 결론을 말합니다.",
  "- 오류창/설정 화면이면 원인 → 해결 방법 순서로 답합니다.",
  "표기 원칙:",
  "- 가독성이 좋아지면 √, ×, →, %, kW 같은 표기를 적극 사용합니다.",
  "- 수식 표기가 유리하면 \\frac{a}{b}, \\sqrt{x} 같은 LaTeX 스타일 표기를 사용해도 됩니다.",
  "중요:",
  "- 확실하지 않은 내용은 확실하지 않다고 표시합니다.",
  "- 이미지 속 단어 몇 개만 보고 성급히 문제 유형을 단정하지 않습니다.",
  "- 보기 문제는 최종 답을 내기 전에 보기와 조건이 실제로 맞는지 다시 확인합니다.",
].join(" ");

const DEFAULT_MODEL = persistedSettings.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const DEFAULT_PROMPT = KOREAN_DEFAULT_PROMPT;
const DEFAULT_PROBLEM_SOLVING_MODEL = process.env.OPENAI_PROBLEM_SOLVING_MODEL || "gpt-5-mini";
const APPROVAL_ONLY_BUILD = process.env.SCREENEXPLAIN_APPROVAL_ONLY !== "false";
const PRODUCTION_REMOTE_API_URL = "https://daehancargocrane.com/wp-json/screenexplain/v1/proxy";
const DEFAULT_REMOTE_API_URL = process.env.SCREENEXPLAIN_REMOTE_API_URL
  || (APPROVAL_ONLY_BUILD ? PRODUCTION_REMOTE_API_URL : "");

const SUPPORTED_MODELS = [
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", contextWindow: 1047576, maxOutputTokens: 32768 },
  { id: "gpt-4.1", label: "GPT-4.1", contextWindow: 1047576, maxOutputTokens: 32768 },
  { id: "gpt-5-mini", label: "GPT-5 mini", contextWindow: 400000, maxOutputTokens: 128000 },
  { id: "gpt-5.1", label: "GPT-5.1", contextWindow: 400000, maxOutputTokens: 128000 },
  { id: "o4-mini", label: "o4-mini", contextWindow: 200000, maxOutputTokens: 100000 },
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

const API_MODEL_CACHE_TTL_MS = 5 * 60 * 1000;

let currentModel = DEFAULT_MODEL;
let currentApiKey = APPROVAL_ONLY_BUILD ? "" : (process.env.OPENAI_API_KEY || loadApiKey());
let currentRemoteApiUrl = normalizeRemoteApiUrl(persistedSettings.remoteApiUrl || DEFAULT_REMOTE_API_URL);
let currentRemoteApiToken = process.env.SCREENEXPLAIN_REMOTE_API_TOKEN || loadRemoteApiToken();
let currentRemoteRequestToken = loadRemoteRequestToken();
let currentRemoteTokenKind = normalizeRemoteTokenKind(
  persistedSettings.remoteTokenKind || inferRemoteTokenKind(currentRemoteApiToken),
);
let currentRemoteAuthUser = normalizeRemoteAuthUser(persistedSettings.remoteAuthUser);
let currentRemoteAuthExpiresAt = normalizeRemoteAuthExpiresAt(persistedSettings.remoteAuthExpiresAt);
let currentRemoteApprovalRequest = normalizeRemoteApprovalRequest(persistedSettings.remoteApprovalRequest);
let savedPrompt = normalizeSavedPrompt(persistedSettings.savedPrompt);
let recentHistory = normalizeRecentHistory(persistedSettings.recentHistory);
let cachedApiModels = [];
let cachedApiModelsFetchedAt = 0;

function isBuiltInPrompt(promptText) {
  const text = typeof promptText === "string" ? promptText.trim() : "";
  return !text
    || text === LEGACY_ENGLISH_DEFAULT_PROMPT
    || text === LEGACY_KOREAN_DEFAULT_PROMPT
    || text === DEFAULT_PROMPT;
}

function normalizeSavedPrompt(promptText) {
  const text = typeof promptText === "string" ? promptText.trim() : "";
  return isBuiltInPrompt(text) ? DEFAULT_PROMPT : text;
}

function getCustomPrompt(promptText = savedPrompt) {
  const text = typeof promptText === "string" ? promptText.trim() : "";
  return isBuiltInPrompt(text) ? "" : text;
}

function normalizeRecentHistory(items) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter((item) => item && typeof item === "object")
    .map((item, index) => ({
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `history-${Date.now()}-${index}`,
      answer: typeof item.answer === "string" ? item.answer : "",
      metaText: typeof item.metaText === "string" ? item.metaText : "",
      promptText: getCustomPrompt(item.promptText),
      pinned: item.pinned === true,
      createdAt:
        typeof item.createdAt === "string" && item.createdAt.trim()
          ? item.createdAt
          : new Date().toISOString(),
    }))
    .slice(0, 30);
}

function inferRemoteTokenKind(token) {
  const value = typeof token === "string" ? token.trim() : "";
  if (!value) {
    return "";
  }
  return value.startsWith("ses_") ? "user-session" : "legacy";
}

function normalizeRemoteTokenKind(value) {
  return ["legacy", "user-session"].includes(value) ? value : "";
}

function normalizeRemoteAuthUser(user) {
  if (!user || typeof user !== "object") {
    return null;
  }

  const email = typeof user.email === "string" ? user.email.trim() : "";
  if (!email) {
    return null;
  }

  return {
    email,
    name: typeof user.name === "string" ? user.name.trim() : "",
    picture: typeof user.picture === "string" ? user.picture.trim() : "",
    status: typeof user.status === "string" ? user.status.trim() : "",
  };
}

function normalizeRemoteAuthExpiresAt(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function normalizeRemoteApprovalRequest(request) {
  if (!request || typeof request !== "object") {
    return null;
  }

  const requestId = typeof request.requestId === "string" ? request.requestId.trim() : "";
  const email = typeof request.email === "string" ? request.email.trim() : "";
  if (!requestId || !email) {
    return null;
  }

  return {
    requestId,
    email,
    name: typeof request.name === "string" ? request.name.trim() : "",
    note: typeof request.note === "string" ? request.note.trim() : "",
    deviceLabel: typeof request.deviceLabel === "string" ? request.deviceLabel.trim() : "",
    status: typeof request.status === "string" ? request.status.trim() : "pending",
    requestedAt: typeof request.requestedAt === "string" ? request.requestedAt.trim() : "",
    updatedAt: typeof request.updatedAt === "string" ? request.updatedAt.trim() : "",
  };
}

function getDefaultDeviceLabel() {
  const host = typeof os.hostname === "function" ? os.hostname().trim() : "";
  return host || "Windows PC";
}

function setRemoteApprovalRequest(request) {
  currentRemoteApprovalRequest = normalizeRemoteApprovalRequest(request);
  if (currentRemoteRequestToken) {
    saveRemoteRequestToken(currentRemoteRequestToken);
  } else {
    clearRemoteRequestToken();
  }
  persistAppSettings();
}

function clearRemoteApprovalRequest() {
  currentRemoteApprovalRequest = null;
  currentRemoteRequestToken = "";
  clearRemoteRequestToken();
  persistAppSettings();
}

function setRemoteAuthSession({ token = "", tokenKind = "", user = null, expiresAt = "" } = {}) {
  currentRemoteApiToken = typeof token === "string" ? token.trim() : "";
  currentRemoteTokenKind = normalizeRemoteTokenKind(tokenKind || inferRemoteTokenKind(currentRemoteApiToken));
  currentRemoteAuthUser = normalizeRemoteAuthUser(user);
  currentRemoteAuthExpiresAt = normalizeRemoteAuthExpiresAt(expiresAt);

  if (currentRemoteApiToken) {
    saveRemoteApiToken(currentRemoteApiToken);
  } else {
    clearRemoteApiToken();
  }

  persistAppSettings();
}

function clearRemoteAuthSession({ preserveRemoteUrl = true } = {}) {
  currentRemoteApiToken = "";
  currentRemoteTokenKind = "";
  currentRemoteAuthUser = null;
  currentRemoteAuthExpiresAt = "";
  clearRemoteApiToken();

  if (!preserveRemoteUrl) {
    currentRemoteApiUrl = "";
  }

  persistAppSettings();
}

function persistAppSettings() {
  saveSettings({
    model: currentModel,
    remoteApiUrl: currentRemoteApiUrl,
    remoteTokenKind: currentRemoteTokenKind,
    remoteAuthUser: currentRemoteAuthUser,
    remoteAuthExpiresAt: currentRemoteAuthExpiresAt,
    remoteApprovalRequest: currentRemoteApprovalRequest,
    savedPrompt,
    recentHistory,
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";

    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 10 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });

    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseJsonBody(rawBody) {
  try {
    return JSON.parse(rawBody || "{}");
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

function extractText(responseJson) {
  if (typeof responseJson.output_text === "string" && responseJson.output_text.trim()) {
    return responseJson.output_text.trim();
  }

  const output = Array.isArray(responseJson.output) ? responseJson.output : [];
  const chunks = [];

  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (part.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
        continue;
      }

      if (typeof part.text === "string" && part.text.trim()) {
        chunks.push(part.text);
        continue;
      }

      if (typeof part.refusal === "string" && part.refusal.trim()) {
        chunks.push(part.refusal);
      }
    }
  }

  return chunks.join("\n").trim();
}

function isGpt5Model(model) {
  return typeof model === "string" && /^gpt-5([.-]|$)/.test(model);
}

function isGpt41Model(model) {
  return typeof model === "string" && /^gpt-4\.1([.-]|$)/.test(model);
}

function hasModelAccess(model) {
  if (typeof model !== "string" || !model.trim()) {
    return false;
  }

  const modelId = model.trim();
  return modelId === currentModel
    || SUPPORTED_MODELS.some((item) => item.id === modelId)
    || cachedApiModels.some((item) => item.id === modelId);
}

function chooseProblemSolvingModel(model) {
  if (!isGpt41Model(model)) {
    return model;
  }

  const preferredCandidates = [
    DEFAULT_PROBLEM_SOLVING_MODEL,
    "gpt-5-mini",
    "gpt-5.1",
    "gpt-5",
  ];

  return preferredCandidates.find((candidate) => hasModelAccess(candidate)) || model;
}

function getAnalyzeMaxOutputTokens(model, attempt = 1) {
  if (isGpt5Model(model)) {
    return attempt > 1 ? 2200 : 1400;
  }

  return attempt > 1 ? 420 : 280;
}

function isAccuracySensitiveTask(taskTags) {
  return Array.isArray(taskTags) && taskTags.some((taskTag) => taskTag === "problem-solving" || taskTag === "table");
}

function looksMathHeavyText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  return /\\[A-Za-z]+|[_^{}]|(?:\b(?:sin|cos|tan|log|ln|frac|sqrt|int|sum|lim)\b)|[=+\-*/\u00D7\u00F7\u221A\u2211\u222B\u2264\u2265\u2248\u2192]/.test(text);
}

function detectTaskTags({ promptText = "", questionText = "", instructionText = "", mode = "" }) {
  const source = [promptText, questionText, instructionText].join(" ").toLowerCase();
  const selected = [];

  function add(taskTag) {
    if (!selected.includes(taskTag)) {
      selected.push(taskTag);
    }
  }

  if (!source.trim()) {
    return mode === "quick" ? ["general"] : [];
  }

  if (/(번역|translate|translation|영작|해석)/.test(source)) {
    add("translation");
  }

  if (/(표|table|행|열|성적표|가격표|비교표|일정표)/.test(source)) {
    add("table");
  }

  if (/(문제|풀이|계산|정답|선지|보기|시험|퀴즈|수식|공식|전자기|전압|전류|역률|변압기|미분|적분|행렬)/.test(source) || looksMathHeavyText(source)) {
    add("problem-solving");
  }

  if (/(코드|터미널|오류|error|exception|traceback|stack|debug|설정|config|command|powershell|cmd)/.test(source)) {
    add("technical");
  }

  if (/(문서|공지|계약|신청서|안내|문단|요약)/.test(source)) {
    add("document");
  }

  if (/(쇼핑|구매|가격|상품|옵션|스펙|할인)/.test(source)) {
    add("shopping");
  }

  return selected.slice(0, 3);
}

function buildModelSpecificResponseOptions(model, mode, taskTags = []) {
  if (!isGpt5Model(model)) {
    return {};
  }

  const accuracySensitive = isAccuracySensitiveTask(taskTags);
  return {
    reasoning: { effort: accuracySensitive ? (mode === "quick" ? "low" : "medium") : mode === "quick" ? "low" : "medium" },
    text: { verbosity: accuracySensitive || mode === "quick" ? "low" : "medium" },
  };
}

function buildVerificationResponseOptions(model) {
  if (!isGpt5Model(model)) {
    return {};
  }

  return {
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
  };
}

function buildImageInput(imageDataUrl, detail = "auto") {
  return {
    type: "input_image",
    image_url: imageDataUrl,
    detail,
  };
}

function buildUsageSummaryFromResponses(responses, model) {
  const modelMeta = getModelMeta(model);
  const totals = responses.reduce((acc, responseJson) => {
    const usage = responseJson?.usage || {};
    if (typeof usage.input_tokens === "number") {
      acc.inputTokens += usage.input_tokens;
      acc.hasInputTokens = true;
    }
    if (typeof usage.output_tokens === "number") {
      acc.outputTokens += usage.output_tokens;
      acc.hasOutputTokens = true;
    }
    if (typeof usage.total_tokens === "number") {
      acc.totalTokens += usage.total_tokens;
      acc.hasTotalTokens = true;
    }
    return acc;
  }, {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    hasInputTokens: false,
    hasOutputTokens: false,
    hasTotalTokens: false,
  });

  const inputTokens = totals.hasInputTokens ? totals.inputTokens : null;
  const outputTokens = totals.hasOutputTokens ? totals.outputTokens : null;
  const totalTokens = totals.hasTotalTokens
    ? totals.totalTokens
    : [inputTokens, outputTokens].every((value) => typeof value === "number")
      ? inputTokens + outputTokens
      : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    remainingContextTokens:
      modelMeta && typeof totalTokens === "number"
        ? Math.max(modelMeta.contextWindow - totalTokens, 0)
        : null,
  };
}

function normalizeAvailableModels(apiModels = []) {
  const knownModels = new Map(SUPPORTED_MODELS.map((item) => [item.id, item]));
  const merged = [];
  const seen = new Set();

  for (const model of apiModels) {
    const id = typeof model?.id === "string" ? model.id.trim() : "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const known = knownModels.get(id);
    merged.push({
      id,
      label: known?.label || id,
      contextWindow: typeof known?.contextWindow === "number" ? known.contextWindow : null,
      maxOutputTokens: typeof known?.maxOutputTokens === "number" ? known.maxOutputTokens : null,
      ownedBy: typeof model?.owned_by === "string" ? model.owned_by : "",
      created: typeof model?.created === "number" ? model.created : null,
    });
  }

  for (const model of SUPPORTED_MODELS) {
    if (seen.has(model.id)) {
      continue;
    }
    merged.push({
      id: model.id,
      label: model.label,
      contextWindow: model.contextWindow,
      maxOutputTokens: model.maxOutputTokens,
      ownedBy: "",
      created: null,
    });
  }

  return merged.sort((left, right) => left.id.localeCompare(right.id));
}

function describeResponseState(responseJson) {
  const output = Array.isArray(responseJson?.output) ? responseJson.output : [];
  const outputTypes = output.map((item) => item?.type || "unknown").join(",") || "none";
  const incompleteReason = responseJson?.incomplete_details?.reason || "none";
  const outputTokens = responseJson?.usage?.output_tokens;
  const reasoningTokens = responseJson?.usage?.output_tokens_details?.reasoning_tokens;

  return [
    `status=${responseJson?.status || "unknown"}`,
    `incomplete_reason=${incompleteReason}`,
    `output_items=${outputTypes}`,
    `output_tokens=${typeof outputTokens === "number" ? outputTokens : "unknown"}`,
    `reasoning_tokens=${typeof reasoningTokens === "number" ? reasoningTokens : "unknown"}`,
  ].join(" ");
}

function getVerificationMaxOutputTokens(model) {
  return isGpt5Model(model) ? 420 : 260;
}

function parseVerificationResult(rawText) {
  const text = String(rawText || "").trim();
  if (!text) {
    return { keepOriginal: true, revisedAnswer: "" };
  }

  if (/^KEEP\b/i.test(text)) {
    return { keepOriginal: true, revisedAnswer: "" };
  }

  return {
    keepOriginal: false,
    revisedAnswer: text.replace(/^REVISE:\s*/i, "").trim(),
  };
}

function isResponseTruncated(responseJson) {
  return responseJson?.status === "incomplete" && responseJson?.incomplete_details?.reason === "max_output_tokens";
}

async function createResponse(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentApiKey}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json();
  if (!response.ok) {
    const message = json?.error?.message || `OpenAI API error (${response.status})`;
    throw new Error(message);
  }

  return json;
}

async function createRemoteAnalysis(payload, allowRetry = true) {
  if (!currentRemoteApiUrl) {
    throw new Error("Remote API URL is not configured.");
  }

  await ensureRemoteSession();

  const response = await fetch(currentRemoteApiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentRemoteApiToken}`,
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    if ([401, 403].includes(response.status) && currentRemoteTokenKind === "user-session") {
      clearRemoteAuthSession();
      if (allowRetry && currentRemoteApprovalRequest && currentRemoteRequestToken) {
        await ensureRemoteSession();
        return createRemoteAnalysis(payload, false);
      }
      throw new Error("Remote login expired. Request approval again.");
    }
    const message = json?.error || `Remote API error (${response.status})`;
    throw new Error(message);
  }

  return json;
}

async function fetchRemoteHealth() {
  if (!currentRemoteApiUrl) {
    throw new Error("Remote API URL is not configured.");
  }

  const headers = {};
  if (currentRemoteApiToken) {
    headers.Authorization = `Bearer ${currentRemoteApiToken}`;
  }

  const response = await fetch(currentRemoteApiUrl, { headers });
  const json = await response.json().catch(() => ({}));

  if (!response.ok || json?.ok !== true) {
    const message = json?.error || `Remote API error (${response.status})`;
    throw new Error(message);
  }

  return json;
}

async function testRemoteApi() {
  if (!currentRemoteApiUrl) {
    throw new Error("Remote API URL is not configured.");
  }

  const json = await fetchRemoteHealth();
  const tokenType = json?.auth?.tokenType || currentRemoteTokenKind;
  if (tokenType === "session" && json?.auth?.user) {
    currentRemoteTokenKind = "user-session";
    currentRemoteAuthUser = normalizeRemoteAuthUser(json.auth.user);
    currentRemoteAuthExpiresAt = normalizeRemoteAuthExpiresAt(json?.auth?.sessionExpiresAt);
    persistAppSettings();
  } else if (!currentRemoteApiToken && currentRemoteApprovalRequest && currentRemoteRequestToken) {
    try {
      await fetchRemoteApprovalStatus({ autoIssueSession: true, health: json });
    } catch {
      // Connectivity test should still succeed even if approval is still pending.
    }
  }

  return {
    ok: true,
    backendMode: currentRemoteApiToken ? "remote" : currentRemoteApprovalRequest ? "remote-pending" : "remote-ready",
    auth: json?.auth || null,
  };
}

function getRemoteApprovalEndpoints(auth) {
  const requestAccessUrl = typeof auth?.requestAccessUrl === "string" ? auth.requestAccessUrl : "";
  const requestStatusUrl = typeof auth?.requestStatusUrl === "string" ? auth.requestStatusUrl : "";
  const issueSessionUrl = typeof auth?.issueSessionUrl === "string" ? auth.issueSessionUrl : "";

  if (!requestAccessUrl || !requestStatusUrl || !issueSessionUrl) {
    throw new Error("Remote server did not expose the approval endpoints.");
  }

  return {
    requestAccessUrl,
    requestStatusUrl,
    issueSessionUrl,
  };
}

function getStoredRemoteRequestCredentials() {
  const requestId = currentRemoteApprovalRequest?.requestId || "";
  if (!requestId || !currentRemoteRequestToken) {
    throw new Error("No remote approval request is stored on this device.");
  }

  return {
    requestId,
    requestToken: currentRemoteRequestToken,
  };
}

async function submitRemoteApprovalRequest({ name = "", email = "", note = "", deviceLabel = "" } = {}) {
  if (!currentRemoteApiUrl) {
    throw new Error("Remote API URL is not configured.");
  }

  const health = await fetchRemoteHealth();
  const endpoints = getRemoteApprovalEndpoints(health?.auth || {});
  const payload = {
    name: typeof name === "string" ? name.trim() : "",
    email: typeof email === "string" ? email.trim() : "",
    note: typeof note === "string" ? note.trim() : "",
    device_label: typeof deviceLabel === "string" && deviceLabel.trim() ? deviceLabel.trim() : getDefaultDeviceLabel(),
  };

  if (currentRemoteApprovalRequest?.requestId && currentRemoteRequestToken) {
    payload.requestId = currentRemoteApprovalRequest.requestId;
    payload.requestToken = currentRemoteRequestToken;
  }

  const response = await fetch(endpoints.requestAccessUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok || !json?.requestId) {
    const message = json?.error || `Remote API error (${response.status})`;
    throw new Error(message);
  }

  if (typeof json.requestToken === "string" && json.requestToken.trim()) {
    currentRemoteRequestToken = json.requestToken.trim();
  }

  setRemoteApprovalRequest({
    requestId: json.requestId,
    email: json?.user?.email || payload.email,
    name: json?.user?.name || payload.name,
    note: payload.note,
    deviceLabel: payload.device_label,
    status: json?.status || "pending",
    requestedAt: currentRemoteApprovalRequest?.requestedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (!currentRemoteRequestToken) {
    throw new Error("Remote server did not return an approval token.");
  }

  return {
    ok: true,
    status: json?.status || "pending",
    user: json?.user || null,
  };
}

async function fetchRemoteApprovalStatus({ autoIssueSession = false, health = null } = {}) {
  const endpoints = getRemoteApprovalEndpoints((health || await fetchRemoteHealth())?.auth || {});
  const credentials = getStoredRemoteRequestCredentials();
  const response = await fetch(endpoints.requestStatusUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok) {
    const message = json?.error || `Remote API error (${response.status})`;
    throw new Error(message);
  }

  setRemoteApprovalRequest({
    requestId: credentials.requestId,
    email: json?.user?.email || currentRemoteApprovalRequest?.email || "",
    name: json?.user?.name || currentRemoteApprovalRequest?.name || "",
    note: currentRemoteApprovalRequest?.note || "",
    deviceLabel: currentRemoteApprovalRequest?.deviceLabel || getDefaultDeviceLabel(),
    status: json?.status || "pending",
    requestedAt: currentRemoteApprovalRequest?.requestedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  if (json?.status === "approved" && autoIssueSession) {
    const session = await issueRemoteSessionFromApproval({ health });
    return {
      ok: true,
      status: "approved",
      user: session.user,
      expiresAt: session.expiresAt,
    };
  }

  if (json?.status === "blocked") {
    clearRemoteAuthSession();
  }

  return {
    ok: true,
    status: json?.status || "pending",
    user: json?.user || null,
    expiresAt: "",
  };
}

async function issueRemoteSessionFromApproval({ health = null } = {}) {
  const endpoints = getRemoteApprovalEndpoints((health || await fetchRemoteHealth())?.auth || {});
  const credentials = getStoredRemoteRequestCredentials();
  const response = await fetch(endpoints.issueSessionUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json?.ok || !json?.token) {
    const message = json?.error || `Remote API error (${response.status})`;
    throw new Error(message);
  }

  setRemoteAuthSession({
    token: json.token,
    tokenKind: "user-session",
    user: json.user || null,
    expiresAt: json.expiresAt || "",
  });
  setRemoteApprovalRequest({
    requestId: credentials.requestId,
    email: json?.user?.email || currentRemoteApprovalRequest?.email || "",
    name: json?.user?.name || currentRemoteApprovalRequest?.name || "",
    note: currentRemoteApprovalRequest?.note || "",
    deviceLabel: currentRemoteApprovalRequest?.deviceLabel || getDefaultDeviceLabel(),
    status: "approved",
    requestedAt: currentRemoteApprovalRequest?.requestedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  return {
    ok: true,
    user: normalizeRemoteAuthUser(json.user),
    expiresAt: normalizeRemoteAuthExpiresAt(json.expiresAt),
  };
}

async function ensureRemoteSession() {
  if (currentRemoteApiToken) {
    return;
  }

  if (!currentRemoteApprovalRequest || !currentRemoteRequestToken) {
    throw new Error("Remote login or shared token is required.");
  }

  const status = await fetchRemoteApprovalStatus({ autoIssueSession: true });
  if (currentRemoteApiToken) {
    return;
  }

  if (status?.status === "pending") {
    throw new Error("Remote access is still pending approval.");
  }
  if (status?.status === "blocked") {
    throw new Error("This device is blocked by the remote admin.");
  }

  throw new Error("Remote session could not be issued.");
}

async function logoutRemoteAuth() {
  if (currentRemoteApiUrl && currentRemoteApiToken && currentRemoteTokenKind === "user-session") {
    try {
      const health = await fetchRemoteHealth();
      const logoutUrl = health?.auth?.logoutUrl;
      if (logoutUrl) {
        await fetch(logoutUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${currentRemoteApiToken}`,
          },
        });
      }
    } catch {
      // Best-effort remote revocation. Local cleanup still happens below.
    }
  }

  clearRemoteAuthSession();
  clearRemoteApprovalRequest();
}

async function analyzeWithRemoteApi({
  imageDataUrl,
  promptText,
  questionText = "",
  instructionText = "",
  mode = "default",
  modelOverride = "",
}) {
  const resolvedPrompt = resolvePrompt(promptText);
  const taskTags = detectTaskTags({
    promptText: resolvedPrompt,
    questionText,
    instructionText,
    mode,
  });
  const requestModel = resolveModelForRequest(mode, modelOverride, taskTags);

  const json = await createRemoteAnalysis({
    image_base64: imageDataUrl,
    prompt: resolvedPrompt,
    question: typeof questionText === "string" ? questionText.trim() : "",
    instruction: typeof instructionText === "string" ? instructionText.trim() : "",
    model: requestModel,
  });

  const answer = typeof json?.answer === "string" ? json.answer.trim() : "";
  if (!answer) {
    throw new Error("Remote API returned an empty answer.");
  }

  const resolvedModel = typeof json?.model === "string" && json.model.trim()
    ? json.model.trim()
    : requestModel;

  return {
    answer,
    model: resolvedModel,
    promptText: getCustomPrompt(resolvedPrompt),
    usage: buildUsageSummary({ usage: json?.usage || {} }, resolvedModel),
  };
}

async function fetchAvailableModels({ forceRefresh = false } = {}) {
  if (!currentApiKey) {
    return normalizeAvailableModels();
  }

  const now = Date.now();
  if (!forceRefresh && cachedApiModels.length && now - cachedApiModelsFetchedAt < API_MODEL_CACHE_TTL_MS) {
    return cachedApiModels;
  }

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${currentApiKey}`,
    },
  });
  const json = await response.json();

  if (!response.ok) {
    const message = json?.error?.message || `OpenAI API error (${response.status})`;
    throw new Error(message);
  }

  cachedApiModels = normalizeAvailableModels(Array.isArray(json?.data) ? json.data : []);
  cachedApiModelsFetchedAt = now;
  return cachedApiModels;
}

async function getAvailableModelsSafe(options = {}) {
  try {
    return await fetchAvailableModels(options);
  } catch {
    return normalizeAvailableModels();
  }
}

async function buildSettingsPayload({ includeStatus = false, forceRefreshModels = false } = {}) {
  const payload = {
    backendMode: getActiveBackendMode(),
    apiKeyConfigured: Boolean(currentApiKey),
    apiKeyMasked: maskApiKey(currentApiKey),
    remoteApiConfigured: hasRemoteApiConfigured(),
    remoteApiUrlConfigured: Boolean(currentRemoteApiUrl),
    remoteApiUrl: currentRemoteApiUrl,
    remoteApiTokenMasked: maskApiKey(currentRemoteApiToken),
    remoteTokenKind: currentRemoteTokenKind,
    remoteAuthUser: currentRemoteAuthUser,
    remoteAuthExpiresAt: currentRemoteAuthExpiresAt,
    remoteApprovalRequest: currentRemoteApprovalRequest,
    model: currentModel,
    savedPrompt,
    customPrompt: getCustomPrompt(savedPrompt),
    recentHistory,
    supportedModels: await getAvailableModelsSafe({ forceRefresh: forceRefreshModels }),
  };

  if (includeStatus) {
    payload.ok = true;
  }

  return payload;
}

function maskApiKey(apiKey) {
  if (!apiKey) {
    return "";
  }

  if (apiKey.length <= 12) {
    return `${apiKey.slice(0, 4)}...`;
  }

  return `${apiKey.slice(0, 7)}...${apiKey.slice(-4)}`;
}

function normalizeRemoteApiUrl(url) {
  const trimmed = typeof url === "string" ? url.trim() : "";
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function hasRemoteApiConfigured() {
  return Boolean(currentRemoteApiUrl && currentRemoteApiToken);
}

function shouldUseRemoteApi() {
  if (APPROVAL_ONLY_BUILD) {
    return Boolean(currentRemoteApiUrl);
  }

  return hasRemoteApiConfigured();
}

function getActiveBackendMode() {
  if (shouldUseRemoteApi()) {
    if (currentRemoteApiToken) {
      return "remote";
    }
    if (currentRemoteApprovalRequest) {
      return "remote-pending";
    }
    return "remote-ready";
  }

  return "openai";
}

function getModelMeta(model) {
  return SUPPORTED_MODELS.find((item) => item.id === model) || null;
}

function buildUsageSummary(responseJson, model) {
  const usage = responseJson.usage || {};
  const modelMeta = getModelMeta(model);
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : null;
  const outputTokens = typeof usage.output_tokens === "number" ? usage.output_tokens : null;
  const totalTokens = typeof usage.total_tokens === "number"
    ? usage.total_tokens
    : [inputTokens, outputTokens].every((value) => typeof value === "number")
      ? inputTokens + outputTokens
      : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    remainingContextTokens:
      modelMeta && typeof totalTokens === "number"
        ? Math.max(modelMeta.contextWindow - totalTokens, 0)
        : null,
  };
}

function resolvePrompt(customPrompt) {
  return customPrompt && customPrompt.trim() ? customPrompt.trim() : savedPrompt || DEFAULT_PROMPT;
}

function resolveModelForRequest(mode, modelOverride, taskTags = []) {
  const requestedModel = modelOverride || currentModel;

  if (isAccuracySensitiveTask(taskTags)) {
    return chooseProblemSolvingModel(requestedModel);
  }

  return requestedModel;
}

function buildTaskGuidance(taskTags) {
  const guidance = [];

  if (taskTags.includes("problem-solving")) {
    guidance.push("문제처럼 보이면 조건, 수식, 선지, 단위를 먼저 확인하고 최종 답을 먼저 제시한 뒤 검증 가능한 최소한의 근거만 덧붙입니다.");
  }
  if (taskTags.includes("table")) {
    guidance.push("표처럼 보이면 제목, 열 헤더, 행 레이블, 단위를 먼저 확인하고 값은 어느 행과 열의 값인지 함께 설명합니다.");
  }
  if (taskTags.includes("translation")) {
    guidance.push("번역이 목적이면 한국어 기준으로 자연스럽게 옮기고 애매한 부분만 짧게 덧붙입니다.");
  }
  if (taskTags.includes("technical")) {
    guidance.push("기술 화면이면 오류 원인이나 다음 확인 단계를 가장 짧게 제시합니다.");
  }
  if (taskTags.includes("document")) {
    guidance.push("문서나 공지면 핵심 내용, 마감, 해야 할 일을 우선순위대로 요약합니다.");
  }
  if (taskTags.includes("shopping")) {
    guidance.push("상품 화면이면 상품명, 옵션 차이, 가격, 중요한 스펙 위주로 정리합니다.");
  }

  if (!guidance.length) {
    guidance.push("화면에서 가장 중요한 정보와 바로 필요한 결론을 먼저 짚고, 필요하면 다음 행동만 짧게 덧붙입니다.");
  }

  return guidance.join(" ");
}

function buildSystemInstruction(mode, promptText, taskTags) {
  const shared = [
    "당신은 현재 화면을 바탕으로 답하는 ScreenExplain 보조 도우미입니다.",
    "답변은 화면에 실제로 보이거나 이미지에서 직접 추론 가능한 내용에만 근거합니다.",
    "이미지가 흐리거나 잘려 있거나 불완전하면 추측하지 말고 부족한 부분을 말합니다.",
    `작업 지침: ${buildTaskGuidance(taskTags)}`,
    `사용자 추가 프롬프트: ${promptText}`,
  ];

  if (mode === "quick") {
    return [
      ...shared,
      "답변은 짧고 핵심 위주로 합니다.",
      "문제나 질문처럼 보이면 최종 답을 먼저 말하고, 필요한 최소한의 근거만 덧붙입니다.",
      "정말 필요한 경우가 아니면 3문장 이내로 답합니다.",
    ].join(" ");
  }

  return [
    ...shared,
    "간단한 설명을 먼저 하고, 행동이 필요하면 다음 단계를 짧게 덧붙입니다.",
    "부가 정보보다 핵심 정보를 먼저 요약합니다.",
  ].join(" ");
}

function shouldRunVerificationPass({ mode, requestModel, accuracySensitive }) {
  if (!accuracySensitive) {
    return false;
  }

  if (mode === "quick" && isGpt5Model(requestModel)) {
    return false;
  }

  return true;
}

async function analyzeScreen({
  imageDataUrl,
  promptText,
  questionText = "",
  instructionText = "",
  mode = "default",
  modelOverride = "",
}) {
  if (shouldUseRemoteApi()) {
    return analyzeWithRemoteApi({
      imageDataUrl,
      promptText,
      questionText,
      instructionText,
      mode,
      modelOverride,
    });
  }

  if (!currentApiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    throw new Error("imageDataUrl must be a data:image URL.");
  }

  const resolvedPrompt = resolvePrompt(promptText);
  const taskTags = detectTaskTags({
    promptText: resolvedPrompt,
    questionText,
    instructionText,
    mode,
  });
  const requestModel = resolveModelForRequest(mode, modelOverride, taskTags);
  const runtimeInstruction = typeof instructionText === "string" && instructionText.trim() ? instructionText.trim() : "";
  const baseInstruction = buildSystemInstruction(mode, resolvedPrompt, taskTags);
  const systemInstruction = runtimeInstruction
    ? `${baseInstruction} Additional runtime instruction: ${runtimeInstruction}`
    : baseInstruction;
  const baseUserQuestion = typeof questionText === "string" && questionText.trim()
    ? questionText.trim()
    : mode === "quick"
      ? "Analyze the selected screen region and answer according to the configured prompt."
      : "Analyze the current screen and answer according to the configured prompt.";
  const accuracySensitive = isAccuracySensitiveTask(taskTags);
  const userQuestion = accuracySensitive
    ? `${baseUserQuestion} Return the final answer first. Then give only the minimum reasoning in at most 4 short lines. Avoid long prose and do not repeat the problem statement.`
    : baseUserQuestion;
  const modelOptions = buildModelSpecificResponseOptions(requestModel, mode, taskTags);
  const responseChain = [];
  const imageDetail = accuracySensitive ? "high" : "auto";

  const basePayload = {
    model: requestModel,
    max_output_tokens: getAnalyzeMaxOutputTokens(requestModel, 1),
    ...modelOptions,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemInstruction }],
      },
      {
        role: "user",
        content: [
          { type: "input_text", text: userQuestion },
          buildImageInput(imageDataUrl, imageDetail),
        ],
      },
    ],
  };

  let json = await createResponse(basePayload);
  responseChain.push(json);
  let answer = extractText(json);
  let answerWasTruncated = isResponseTruncated(json);

  if (!answer) {
    console.warn(`[ScreenExplain] Empty response on first attempt. model=${requestModel} ${describeResponseState(json)}`);
    json = await createResponse({
      ...basePayload,
      model: requestModel,
      max_output_tokens: getAnalyzeMaxOutputTokens(requestModel, 2),
      ...modelOptions,
      input: [
        {
          role: "system",
          content: [{
            type: "input_text",
            text: `${systemInstruction} Return a plain text answer only. Do not leave the response empty.`,
          }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: `${userQuestion} Reply with plain text only.` },
            buildImageInput(imageDataUrl, imageDetail),
          ],
        },
      ],
    });
    responseChain.push(json);
    answer = extractText(json);
    answerWasTruncated = isResponseTruncated(json);
  }

  if (!answer) {
    throw new Error(`No response text was returned. model=${requestModel} ${describeResponseState(json)}`);
  }

  const shouldRewriteTruncatedAnswer = answerWasTruncated
    && (accuracySensitive || looksMathHeavyText(answer) || looksMathHeavyText(baseUserQuestion) || looksMathHeavyText(runtimeInstruction));
  const shouldVerifyAnswer = shouldRunVerificationPass({ mode, requestModel, accuracySensitive });

  if (shouldVerifyAnswer || shouldRewriteTruncatedAnswer) {
    const verificationOptions = buildVerificationResponseOptions(requestModel);

    if (shouldRewriteTruncatedAnswer) {
      const rewriteJson = await createResponse({
        model: requestModel,
        previous_response_id: json.id,
        max_output_tokens: getVerificationMaxOutputTokens(requestModel),
        ...verificationOptions,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                systemInstruction,
                "The previous answer was cut off because it hit an output limit.",
                "Rewrite the answer completely in plain text.",
                "State the final answer first, then keep the explanation to at most 4 short lines.",
                "Do not repeat the full problem statement.",
                "Do not mention truncation or token limits in the answer.",
                "If the screenshot is ambiguous, state exactly what is unclear instead of guessing.",
              ].join(" "),
            }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `Original task: ${userQuestion}`,
                  `Truncated answer: ${answer}`,
                  "Return only the completed concise answer.",
                ].join("\n"),
              },
            ],
          },
        ],
      });
      responseChain.push(rewriteJson);
      const rewrittenAnswer = extractText(rewriteJson);
      if (rewrittenAnswer) {
        json = rewriteJson;
        answer = rewrittenAnswer;
      }
    } else if (shouldVerifyAnswer) {
      const verificationJson = await createResponse({
        model: requestModel,
        previous_response_id: json.id,
        max_output_tokens: getVerificationMaxOutputTokens(requestModel),
        ...verificationOptions,
        input: [
          {
            role: "system",
            content: [{
              type: "input_text",
              text: [
                systemInstruction,
                "You are doing a final verification pass for a problem-solving answer.",
                "Check every visible number, symbol, unit, option, and equation against the candidate answer.",
                "If the candidate answer is fully correct, supported, and complete, reply exactly KEEP.",
                "If it is wrong or unsupported, reply with REVISE: followed by a corrected plain text answer.",
                "If it is incomplete or cut off, reply with REVISE: followed by the full concise answer.",
                "When revising, state the final answer first and keep the explanation to at most 4 short lines.",
                "If the screenshot is ambiguous, say exactly which part is unclear instead of guessing.",
              ].join(" "),
            }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `Original task: ${userQuestion}`,
                  `Candidate answer: ${answer}`,
                  "Return either KEEP or REVISE: <corrected answer>.",
                ].join("\n"),
              },
            ],
          },
        ],
      });
      responseChain.push(verificationJson);
      const verificationResult = parseVerificationResult(extractText(verificationJson));
      if (!verificationResult.keepOriginal && verificationResult.revisedAnswer) {
        json = verificationJson;
        answer = verificationResult.revisedAnswer;
      }
    }
  }

  const resolvedModel = json.model || requestModel;
  return {
    answer,
    model: resolvedModel,
    promptText: getCustomPrompt(resolvedPrompt),
    usage: buildUsageSummaryFromResponses(responseChain, resolvedModel),
  };
}

async function testApiKey() {
  if (shouldUseRemoteApi()) {
    return testRemoteApi();
  }

  if (!currentApiKey) {
    throw new Error("OpenAI API key is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${currentApiKey}`,
    },
  });
  const json = await response.json();

  if (!response.ok) {
    const message = json?.error?.message || `OpenAI API error (${response.status})`;
    throw new Error(message);
  }

  return { ok: true, backendMode: "openai" };
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "Forbidden path." });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "File not found." });
      return;
    }

    res.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  });
}

function requestHandler(req, res) {
  return (async () => {
    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        backendMode: getActiveBackendMode(),
        apiKeyConfigured: Boolean(currentApiKey),
        apiKeyMasked: maskApiKey(currentApiKey),
        remoteApiConfigured: hasRemoteApiConfigured(),
        remoteApiUrl: currentRemoteApiUrl,
        remoteApiTokenMasked: maskApiKey(currentRemoteApiToken),
        remoteTokenKind: currentRemoteTokenKind,
        remoteAuthUser: currentRemoteAuthUser,
        remoteAuthExpiresAt: currentRemoteAuthExpiresAt,
        remoteApprovalRequest: currentRemoteApprovalRequest,
        model: currentModel,
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/settings") {
      sendJson(res, 200, await buildSettingsPayload());
      return;
    }

    if (req.method === "POST" && req.url === "/api/settings") {
      try {
        const rawBody = await readBody(req);
        const body = parseJsonBody(rawBody);
        const nextModel = typeof body.model === "string" ? body.model.trim() : "";
        const nextApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : null;
        const nextRemoteApiToken = typeof body.remoteApiToken === "string" ? body.remoteApiToken.trim() : null;
        const hasRemoteApiUrl = Object.prototype.hasOwnProperty.call(body, "remoteApiUrl");
        const nextRemoteApiUrl = hasRemoteApiUrl ? normalizeRemoteApiUrl(body.remoteApiUrl) : "";
        const hasSavedPrompt = Object.prototype.hasOwnProperty.call(body, "savedPrompt");
        const nextPrompt = hasSavedPrompt && typeof body.savedPrompt === "string" ? body.savedPrompt.trim() : "";
        const nextRecentHistory = Array.isArray(body.recentHistory)
          ? normalizeRecentHistory(body.recentHistory)
          : null;
        const clearStoredKey = body.clearApiKey === true;
        const clearStoredRemoteApiToken = body.clearRemoteApiToken === true;

        if (
          !nextModel
          && nextApiKey === null
          && nextRemoteApiToken === null
          && !hasRemoteApiUrl
          && !clearStoredKey
          && !clearStoredRemoteApiToken
          && !hasSavedPrompt
          && nextRecentHistory === null
        ) {
          sendJson(res, 400, { error: "No settings values were provided." });
          return;
        }

        if (hasRemoteApiUrl && typeof body.remoteApiUrl === "string" && body.remoteApiUrl.trim() && !nextRemoteApiUrl) {
          sendJson(res, 400, { error: "Remote API URL is invalid." });
          return;
        }

        if (APPROVAL_ONLY_BUILD && (nextApiKey !== null || clearStoredKey)) {
          sendJson(res, 403, { error: "Local OpenAI key settings are disabled in this build." });
          return;
        }

        if (APPROVAL_ONLY_BUILD && (hasRemoteApiUrl || nextRemoteApiToken !== null || clearStoredRemoteApiToken)) {
          sendJson(res, 403, { error: "Remote approval settings are fixed in this build." });
          return;
        }

        if (nextModel) {
          currentModel = nextModel;
        }

        if (hasSavedPrompt) {
          savedPrompt = normalizeSavedPrompt(nextPrompt);
        }

        if (nextRecentHistory !== null) {
          recentHistory = nextRecentHistory;
        }

        if (hasRemoteApiUrl) {
          const previousRemoteApiUrl = currentRemoteApiUrl;
          currentRemoteApiUrl = nextRemoteApiUrl;
          if (previousRemoteApiUrl !== currentRemoteApiUrl) {
            clearRemoteAuthSession();
            clearRemoteApprovalRequest();
          }
        }

        if (nextApiKey !== null) {
          currentApiKey = nextApiKey;
          cachedApiModels = [];
          cachedApiModelsFetchedAt = 0;
          saveApiKey(currentApiKey);
        } else if (clearStoredKey) {
          currentApiKey = "";
          cachedApiModels = [];
          cachedApiModelsFetchedAt = 0;
          clearApiKey();
        }

        if (nextRemoteApiToken !== null) {
          setRemoteAuthSession({
            token: nextRemoteApiToken,
            tokenKind: inferRemoteTokenKind(nextRemoteApiToken),
            user: null,
            expiresAt: "",
          });
        } else if (clearStoredRemoteApiToken) {
          clearRemoteAuthSession();
        }

        persistAppSettings();

        sendJson(res, 200, await buildSettingsPayload({
          includeStatus: true,
          forceRefreshModels: nextApiKey !== null || clearStoredKey,
        }));
      } catch (error) {
        sendJson(res, 400, { error: error.message || "Failed to save settings." });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/test-auth") {
      try {
        const result = await testApiKey();
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || "Authentication test failed." });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/auth/request-access") {
      try {
        const rawBody = await readBody(req);
        const body = parseJsonBody(rawBody);
        const result = await submitRemoteApprovalRequest(body);
        sendJson(res, 200, {
          ...(await buildSettingsPayload({ includeStatus: true })),
          requestStatus: result.status,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || "Could not submit the access request." });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/auth/check-status") {
      try {
        const result = await fetchRemoteApprovalStatus({ autoIssueSession: true });
        sendJson(res, 200, {
          ...(await buildSettingsPayload({ includeStatus: true })),
          requestStatus: result.status,
        });
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || "Could not refresh the approval status." });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/auth/logout") {
      try {
        await logoutRemoteAuth();
        sendJson(res, 200, await buildSettingsPayload({ includeStatus: true }));
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || "Logout failed." });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/analyze") {
      try {
        const rawBody = await readBody(req);
        const body = parseJsonBody(rawBody);
        const { imageDataUrl, mode, modelOverride, promptText, question, instruction } = body;

        if (!imageDataUrl) {
          sendJson(res, 400, { error: "imageDataUrl is required." });
          return;
        }

        const result = await analyzeScreen({
          imageDataUrl,
          mode,
          modelOverride,
          promptText,
          questionText: question,
          instructionText: instruction,
        });
        sendJson(res, 200, result);
      } catch (error) {
        const statusCode = [
          "Request body must be valid JSON.",
          "imageDataUrl must be a data:image URL.",
        ].includes(error.message)
          ? 400
          : 500;
        sendJson(res, statusCode, { error: error.message || "Server error." });
      }
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "Method not allowed." });
  })();
}

function createServer() {
  return http.createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      sendJson(res, 500, { error: error.message || "Server error." });
    });
  });
}

function startServer(port = PORT) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

module.exports = {
  PORT,
  SUPPORTED_MODELS,
  createServer,
  startServer,
};

if (require.main === module) {
  startServer()
    .then(() => {
      console.log(`ScreenExplain local server listening on http://127.0.0.1:${PORT}`);
      console.log(`Backend mode: ${getActiveBackendMode()}`);
      console.log(`OpenAI key configured: ${Boolean(currentApiKey)}`);
      console.log(`Remote API configured: ${hasRemoteApiConfigured()}`);
      console.log(`Current model: ${currentModel}`);
      console.log(`Saved prompt configured: ${Boolean(savedPrompt)}`);
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}
