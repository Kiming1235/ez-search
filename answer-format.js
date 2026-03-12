(function attachAnswerFormatter() {
  const KOREAN_RANGE = "\\uAC00-\\uD7A3";
  const INLINE_TOKEN = `A-Za-z${KOREAN_RANGE}0-9()[\\].,%`;
  const SIMPLE_MATH_RE = new RegExp(
    `^(?:\\b(?:sin|cos|tan|log|ln)\\b\\s*\\([^)]*\\)|[${INLINE_TOKEN}]+(?:\\s*[=+\\-\\u00D7\\u00F7*/^\\u221A\\u2211\\u222B<>\\u2264\\u2265\\u2248\\u2192]\\s*[${INLINE_TOKEN}]+)+)$`,
  );
  const DISPLAY_MATH_RE = new RegExp("^\\s*(?:\\$\\$.*\\$\\$|\\\\\\[.*\\\\\\]|\\$.*\\$|\\\\frac\\{|.+\\/\\s*\\u221A)");
  const PLAIN_FRACTION_RE = new RegExp(
    `((?:\\([^()\\n]+\\)|[A-Za-z${KOREAN_RANGE}0-9.%]+(?:\\s*[+\\-\\u00D7*]\\s*[A-Za-z${KOREAN_RANGE}0-9.%]+)*))\\s*\\/\\s*((?:\\u221A\\s*\\([^()\\n]+\\)|\\([^()\\n]+\\)|[A-Za-z${KOREAN_RANGE}0-9.%\\u00B2\\u00B3]+(?:\\s*[+\\-\\u00D7*]\\s*[A-Za-z${KOREAN_RANGE}0-9.%\\u00B2\\u00B3]+)*))`,
    "g",
  );
  const LATEX_COMMAND_MAP = {
    alpha: "α",
    beta: "β",
    gamma: "γ",
    delta: "δ",
    epsilon: "ε",
    varepsilon: "ϵ",
    theta: "θ",
    vartheta: "ϑ",
    lambda: "λ",
    mu: "μ",
    pi: "π",
    rho: "ρ",
    sigma: "σ",
    phi: "φ",
    varphi: "ϕ",
    omega: "ω",
    Gamma: "Γ",
    Delta: "Δ",
    Theta: "Θ",
    Lambda: "Λ",
    Pi: "Π",
    Sigma: "Σ",
    Phi: "Φ",
    Omega: "Ω",
    int: "∫",
    sum: "∑",
    prod: "∏",
    times: "×",
    div: "÷",
    cdot: "·",
    pm: "±",
    mp: "∓",
    leq: "≤",
    geq: "≥",
    neq: "≠",
    approx: "≈",
    to: "→",
    rightarrow: "→",
    leftarrow: "←",
    infty: "∞",
    partial: "∂",
    nabla: "∇",
    degree: "°",
    ldots: "…",
    cdots: "⋯",
  };
  const LATEX_SPACE_COMMANDS = new Set([",", ";", ":", "!", "quad", "qquad", "enspace", "thinspace"]);
  const LATEX_DECORATOR_COMMANDS = new Set(["left", "right", "displaystyle", "textstyle"]);

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMathExpression(source) {
    const input = String(source || "").trim();
    let index = 0;

    function peek() {
      return input[index] || "";
    }

    function consume(value) {
      if (input.startsWith(value, index)) {
        index += value.length;
        return true;
      }
      return false;
    }

    function skipSpaces() {
      while (/\s/.test(peek())) {
        index += 1;
      }
    }

    function readCommand() {
      if (peek() !== "\\") {
        return "";
      }
      index += 1;
      let name = "";
      while (/[A-Za-z]/.test(peek())) {
        name += peek();
        index += 1;
      }
      if (name) {
        return name;
      }
      if (peek()) {
        const single = peek();
        index += 1;
        return single;
      }
      return "";
    }

    function parseGroup() {
      skipSpaces();
      if (consume("{")) {
        const node = parseExpression("}");
        consume("}");
        return node;
      }
      return parseAtom();
    }

    function applyScripts(baseHtml) {
      let html = baseHtml;
      while (true) {
        skipSpaces();
        if (consume("^")) {
          const sup = parseGroup();
          html = `<span class="math-base-with-script">${html}<sup class="math-sup">${sup}</sup></span>`;
          continue;
        }
        if (consume("_")) {
          const sub = parseGroup();
          html = `<span class="math-base-with-script">${html}<sub class="math-sub">${sub}</sub></span>`;
          continue;
        }
        break;
      }
      return html;
    }

    function parseAtom() {
      skipSpaces();
      const ch = peek();
      if (!ch) {
        return "";
      }

      if (consume("(")) {
        const inner = parseExpression(")");
        consume(")");
        return applyScripts(`<span class="math-paren">(</span>${inner}<span class="math-paren">)</span>`);
      }

      if (consume("[")) {
        const inner = parseExpression("]");
        consume("]");
        return applyScripts(`<span class="math-paren">[</span>${inner}<span class="math-paren">]</span>`);
      }

      if (ch === "{") {
        consume("{");
        const inner = parseExpression("}");
        consume("}");
        return applyScripts(inner);
      }

      if (ch === "\\") {
        const command = readCommand();
        if (command === "frac") {
          const numerator = parseGroup();
          const denominator = parseGroup();
          return applyScripts(
            `<span class="math-frac"><span class="math-frac-num">${numerator}</span><span class="math-frac-bar"></span><span class="math-frac-den">${denominator}</span></span>`,
          );
        }
        if (command === "sqrt") {
          const body = parseGroup();
          return applyScripts(
            `<span class="math-sqrt"><span class="math-sqrt-sign">\u221A</span><span class="math-sqrt-body">${body}</span></span>`,
          );
        }
        if (LATEX_DECORATOR_COMMANDS.has(command)) {
          return parseAtom();
        }
        if (LATEX_SPACE_COMMANDS.has(command)) {
          return '<span class="math-space"></span>';
        }
        if (LATEX_COMMAND_MAP[command]) {
          return applyScripts(`<span class="math-token">${escapeHtml(LATEX_COMMAND_MAP[command])}</span>`);
        }
        if (command) {
          return applyScripts(`<span class="math-token">${escapeHtml(command)}</span>`);
        }
      }

      let token = "";
      while (peek() && !/[\s{}()[\]^_\\]/.test(peek())) {
        token += peek();
        index += 1;
      }
      if (!token) {
        token = peek();
        index += 1;
      }

      return applyScripts(`<span class="math-token">${escapeHtml(token)}</span>`);
    }

    function parseExpression(until = "") {
      const parts = [];
      while (index < input.length) {
        skipSpaces();
        if (until && peek() === until) {
          break;
        }
        const part = parseAtom();
        if (!part) {
          break;
        }
        parts.push(part);
      }
      return parts.join('<span class="math-space"></span>');
    }

    return parseExpression() || `<span class="math-token">${escapeHtml(input)}</span>`;
  }

  function convertPlainMathToLatex(value) {
    let text = String(value || "").trim();
    text = text.replace(/\u221A\s*\(([^()]+)\)/g, "\\sqrt{$1}");
    const fracMatch = text.match(/^(.+?)\s*\/\s*(\\sqrt\{.+\}|.+)$/);
    if (fracMatch) {
      return `\\frac{${fracMatch[1].trim()}}{${fracMatch[2].trim()}}`;
    }
    return text;
  }

  function renderMathBlock(value, displayMode = false) {
    const normalized = convertPlainMathToLatex(value);
    const html = renderMathExpression(normalized);
    const className = displayMode ? "math-block math-block-display" : "math-block math-block-inline";
    return `<span class="${className}">${html}</span>`;
  }

  function looksLikeMathFragment(value) {
    const text = String(value || "").trim();
    if (!text) {
      return false;
    }

    return /\\[A-Za-z]+|[_^{}]|[=+\-*/]|\b(?:sin|cos|tan|log|ln)\b|[\u221A\u2211\u222B\u2264\u2265\u2248\u2192]/.test(text);
  }

  function tokenizeLine(line) {
    const source = String(line || "");
    const segments = [];
    let cursor = 0;
    let textStart = 0;

    function pushText(end) {
      if (end > textStart) {
        segments.push({ type: "text", value: source.slice(textStart, end) });
      }
    }

    while (cursor < source.length) {
      if (source.startsWith("\\[", cursor)) {
        const end = source.indexOf("\\]", cursor + 2);
        if (end !== -1) {
          pushText(cursor);
          segments.push({ type: "math", value: source.slice(cursor + 2, end), display: true });
          cursor = end + 2;
          textStart = cursor;
          continue;
        }
        const candidate = source.slice(cursor + 2);
        if (looksLikeMathFragment(candidate)) {
          pushText(cursor);
          segments.push({ type: "math", value: candidate, display: true });
          cursor = source.length;
          textStart = cursor;
          break;
        }
      }

      if (source.startsWith("\\(", cursor)) {
        const end = source.indexOf("\\)", cursor + 2);
        if (end !== -1) {
          pushText(cursor);
          segments.push({ type: "math", value: source.slice(cursor + 2, end), display: false });
          cursor = end + 2;
          textStart = cursor;
          continue;
        }
        const candidate = source.slice(cursor + 2);
        if (looksLikeMathFragment(candidate)) {
          pushText(cursor);
          segments.push({ type: "math", value: candidate, display: false });
          cursor = source.length;
          textStart = cursor;
          break;
        }
      }

      if (source.startsWith("$$", cursor)) {
        const end = source.indexOf("$$", cursor + 2);
        if (end !== -1) {
          pushText(cursor);
          segments.push({ type: "math", value: source.slice(cursor + 2, end), display: true });
          cursor = end + 2;
          textStart = cursor;
          continue;
        }
      }

      if (source[cursor] === "$") {
        const end = source.indexOf("$", cursor + 1);
        if (end !== -1) {
          pushText(cursor);
          segments.push({ type: "math", value: source.slice(cursor + 1, end), display: false });
          cursor = end + 1;
          textStart = cursor;
          continue;
        }
      }

      cursor += 1;
    }

    pushText(source.length);

    if (!segments.length) {
      return [{ type: "text", value: source }];
    }

    return segments;
  }

  function splitMathFromText(text) {
    const segments = [];
    let lastIndex = 0;
    text.replace(PLAIN_FRACTION_RE, (match, _num, _den, offset) => {
      if (offset > lastIndex) {
        segments.push({ type: "text", value: text.slice(lastIndex, offset) });
      }
      segments.push({ type: "math", value: match, display: false });
      lastIndex = offset + match.length;
      return match;
    });

    if (!segments.length) {
      return [{ type: "text", value: text }];
    }

    if (lastIndex < text.length) {
      segments.push({ type: "text", value: text.slice(lastIndex) });
    }

    return segments;
  }

  function formatInlineText(line) {
    const explicitSegments = tokenizeLine(line);
    const htmlParts = [];

    for (const segment of explicitSegments) {
      if (segment.type === "math") {
        htmlParts.push(renderMathBlock(segment.value, segment.display));
        continue;
      }

      const mixed = splitMathFromText(segment.value);
      for (const item of mixed) {
        if (item.type === "math" || SIMPLE_MATH_RE.test(item.value.trim())) {
          htmlParts.push(renderMathBlock(item.value, false));
        } else {
          htmlParts.push(escapeHtml(item.value));
        }
      }
    }

    return htmlParts.join("");
  }

  function renderAnswerHtml(text) {
    const lines = String(text || "").split(/\r?\n/);
    const html = lines.map((line) => {
      if (!line.trim()) {
        return '<div class="answer-break" aria-hidden="true"></div>';
      }
      const className = DISPLAY_MATH_RE.test(line.trim())
        ? "answer-line answer-line-display-math"
        : "answer-line";
      return `<div class="${className}">${formatInlineText(line)}</div>`;
    }).join("");

    return html || '<div class="answer-line"></div>';
  }

  window.ScreenExplainAnswerFormat = {
    renderAnswerHtml,
    renderMathBlock,
  };
})();
