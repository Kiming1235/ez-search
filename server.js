const http = require("http");
const fs = require("fs");
const path = require("path");
const { clearApiKey, loadApiKey, saveApiKey } = require("./secure-store");
const { loadSettings, saveSettings } = require("./settings-store");

const PORT = process.env.PORT || 4174;
const ROOT = __dirname;
const persistedSettings = loadSettings();
const DEFAULT_MODEL = persistedSettings.model || process.env.OPENAI_MODEL || "gpt-4.1-mini";
const DEFAULT_PROMPT =
  persistedSettings.savedPrompt ||
  "이 화면에서 사용자가 지금 바로 알아야 할 핵심 내용을 짧고 정확하게 설명해줘. 문제 풀이처럼 보이면 정답과 핵심 근거를 먼저 말해줘.";

let currentModel = DEFAULT_MODEL;
let currentApiKey = process.env.OPENAI_API_KEY || loadApiKey();
let savedPrompt = DEFAULT_PROMPT;

const DEFAULT_QUICK_MODEL = process.env.OPENAI_QUICK_MODEL || "gpt-4.1";

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

function persistAppSettings() {
  saveSettings({
    model: currentModel,
    savedPrompt,
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
        reject(new Error("요청 본문이 너무 큽니다."));
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
    throw new Error("JSON 본문 형식이 올바르지 않습니다.");
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
      }
    }
  }

  return chunks.join("\n").trim();
}

function getModelMeta(model) {
  return SUPPORTED_MODELS.find((item) => item.id === model) || null;
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

function resolveModelForRequest(mode, modelOverride) {
  if (modelOverride) {
    return modelOverride;
  }

  if (mode === "quick" && /mini/i.test(currentModel)) {
    return DEFAULT_QUICK_MODEL;
  }

  return currentModel;
}

function resolvePrompt(customPrompt) {
  return customPrompt && customPrompt.trim() ? customPrompt.trim() : savedPrompt || DEFAULT_PROMPT;
}

function buildSystemInstruction(mode, promptText) {
  if (mode === "quick") {
    return [
      "당신은 화면 일부를 보고 빠르게 답하는 한국어 학습 도우미입니다.",
      "문제집, 수식, 선지, 표, 도형, 그래프가 보이면 먼저 문제 문장을 정확히 읽고 핵심 조건을 정리한 뒤 풀이를 검산하세요.",
      "정답을 추측하지 말고, 화면에 보이는 정보만으로 확실할 때만 답하세요.",
      "불확실하거나 글자가 흐리면 추정하지 말고 '문제가 흐리거나 정보가 부족해 확답이 어렵다'고 말하세요.",
      "답변은 최대 3문장으로 짧게 하되, 정답과 핵심 근거를 함께 제시하세요.",
      `사용자 저장 프롬프트: ${promptText}`,
    ].join(" ");
  }

  return [
    "당신은 사용자의 현재 화면을 보고 설명해 주는 한국어 화면 도우미입니다.",
    "질문에 직접 답하고, 화면에 보이는 요소를 근거로 설명하세요.",
    "민감정보가 보이면 그 자체를 반복 출력하지 말고 주의만 간단히 알리세요.",
    `사용자 저장 프롬프트: ${promptText}`,
  ].join(" ");
}

async function analyzeScreen({ imageDataUrl, promptText, mode = "default", modelOverride = "" }) {
  if (!currentApiKey) {
    throw new Error("OpenAI API 키가 설정되지 않았습니다.");
  }

  if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
    throw new Error("화면 캡처 이미지 형식이 올바르지 않습니다.");
  }

  const requestModel = resolveModelForRequest(mode, modelOverride);
  const resolvedPrompt = resolvePrompt(promptText);
  const systemInstruction = buildSystemInstruction(mode, resolvedPrompt);
  const userQuestion =
    mode === "quick"
      ? "선택한 영역을 저장된 프롬프트 기준으로 정확하게 분석해줘."
      : "현재 화면을 저장된 프롬프트 기준으로 분석해줘.";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentApiKey}`,
    },
    body: JSON.stringify({
      model: requestModel,
      max_output_tokens: 280,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemInstruction }],
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: userQuestion },
            { type: "input_image", image_url: imageDataUrl },
          ],
        },
      ],
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    const message = json?.error?.message || `OpenAI API 오류 (${response.status})`;
    throw new Error(message);
  }

  const answer = extractText(json);
  if (!answer) {
    throw new Error("응답 텍스트를 파싱하지 못했습니다.");
  }

  const resolvedModel = json.model || requestModel;
  return {
    answer,
    model: resolvedModel,
    promptText: resolvedPrompt,
    usage: buildUsageSummary(json, resolvedModel),
  };
}

async function testApiKey() {
  if (!currentApiKey) {
    throw new Error("OpenAI API 키가 설정되지 않았습니다.");
  }

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: {
      Authorization: `Bearer ${currentApiKey}`,
    },
  });
  const json = await response.json();

  if (!response.ok) {
    const message = json?.error?.message || `OpenAI API 오류 (${response.status})`;
    throw new Error(message);
  }

  return { ok: true };
}

function serveStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : req.url;
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(ROOT, safePath);

  if (!filePath.startsWith(ROOT)) {
    sendJson(res, 403, { error: "허용되지 않은 경로입니다." });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "파일을 찾지 못했습니다." });
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
        apiKeyConfigured: Boolean(currentApiKey),
        apiKeyMasked: maskApiKey(currentApiKey),
        model: currentModel,
      });
      return;
    }

    if (req.method === "GET" && req.url === "/api/settings") {
      sendJson(res, 200, {
        apiKeyConfigured: Boolean(currentApiKey),
        apiKeyMasked: maskApiKey(currentApiKey),
        model: currentModel,
        savedPrompt,
        supportedModels: SUPPORTED_MODELS,
      });
      return;
    }

    if (req.method === "POST" && req.url === "/api/settings") {
      try {
        const rawBody = await readBody(req);
        const body = parseJsonBody(rawBody);
        const nextModel = typeof body.model === "string" ? body.model.trim() : "";
        const nextApiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : null;
        const nextPrompt = typeof body.savedPrompt === "string" ? body.savedPrompt.trim() : "";
        const clearStoredKey = body.clearApiKey === true;

        if (!nextModel && nextApiKey === null && !clearStoredKey && !nextPrompt) {
          sendJson(res, 400, { error: "변경할 설정값이 필요합니다." });
          return;
        }

        if (nextModel) {
          currentModel = nextModel;
        }

        if (nextPrompt) {
          savedPrompt = nextPrompt;
        }

        if (nextApiKey !== null) {
          if (!nextApiKey.startsWith("sk-")) {
            sendJson(res, 400, { error: "OpenAI API 키 형식이 올바르지 않습니다." });
            return;
          }
          currentApiKey = nextApiKey;
          saveApiKey(currentApiKey);
        } else if (clearStoredKey) {
          currentApiKey = "";
          clearApiKey();
        }

        persistAppSettings();

        sendJson(res, 200, {
          ok: true,
          apiKeyConfigured: Boolean(currentApiKey),
          apiKeyMasked: maskApiKey(currentApiKey),
          model: currentModel,
          savedPrompt,
          supportedModels: SUPPORTED_MODELS,
        });
      } catch (error) {
        sendJson(res, 400, { error: error.message || "설정 저장에 실패했습니다." });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/test-auth") {
      try {
        const result = await testApiKey();
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, 400, { ok: false, error: error.message || "연결 테스트에 실패했습니다." });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/analyze") {
      try {
        const rawBody = await readBody(req);
        const body = parseJsonBody(rawBody);
        const { imageDataUrl, mode, modelOverride, promptText } = body;

        if (!imageDataUrl) {
          sendJson(res, 400, { error: "imageDataUrl 이 필요합니다." });
          return;
        }

        const result = await analyzeScreen({ imageDataUrl, mode, modelOverride, promptText });
        sendJson(res, 200, result);
      } catch (error) {
        const statusCode = [
          "JSON 본문 형식이 올바르지 않습니다.",
          "화면 캡처 이미지 형식이 올바르지 않습니다.",
        ].includes(error.message)
          ? 400
          : 500;
        sendJson(res, statusCode, { error: error.message || "서버 오류가 발생했습니다." });
      }
      return;
    }

    if (req.method === "GET") {
      serveStatic(req, res);
      return;
    }

    sendJson(res, 405, { error: "허용되지 않은 메서드입니다." });
  })();
}

function createServer() {
  return http.createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      sendJson(res, 500, { error: error.message || "서버 오류가 발생했습니다." });
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
      console.log(`ScreenExplain server listening on http://127.0.0.1:${PORT}`);
      console.log(`OPENAI_API_KEY configured: ${Boolean(currentApiKey)}`);
      console.log(`Current model: ${currentModel}`);
      console.log(`Saved prompt configured: ${Boolean(savedPrompt)}`);
    })
    .catch((error) => {
      console.error(error.message || error);
      process.exitCode = 1;
    });
}
