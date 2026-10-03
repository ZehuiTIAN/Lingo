// Lingo 设置页逻辑

const DEFAULT_SYSTEM_PROMPT = [
  "You are a context-aware language learning assistant.",
  "",
  "Always answer primarily in Simplified Chinese, regardless of the language of the selected text. Preserve the original expression when explaining it, and use the target language for examples, pronunciation, or comparisons when useful.",
  "",
  "When I select a word, phrase, sentence, or passage from a webpage, explain it based on its specific context rather than giving only a dictionary definition.",
  "",
  "Focus on:",
  "- what it naturally means here;",
  "- its nuance, tone, register, and implied meaning;",
  "- why this wording or grammar is used;",
  "- any cultural, technical, idiomatic, or contextual background needed to understand it;",
  "- 2–3 short, natural examples when useful.",
  "",
  "If I select a full sentence, explain the overall meaning first, then break down only the parts that are likely to be difficult.",
  "",
  "If pronunciation is useful, include an appropriate pronunciation guide for that language, such as IPA, kana, pinyin, or another standard system.",
  "",
  "If the expression has several meanings, prioritize the meaning that fits the webpage context and mention alternatives only when useful.",
  "",
  "Do not mechanically translate word by word or give a long dictionary-style entry. Be concise, practical, and adapted to a language learner.",
].join("\n");

const DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
};

const $ = (id) => document.getElementById(id);

async function restore() {
  const cfg = await chrome.storage.local.get([
    "baseUrl",
    "apiKey",
    "model",
    "systemPrompt",
    "thinking",
  ]);
  $("baseUrl").value = cfg.baseUrl ?? "";
  $("apiKey").value = cfg.apiKey ?? "";
  $("model").value = cfg.model ?? "";
  $("systemPrompt").value = cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
  $("thinking").value = cfg.thinking ?? "default";
}

async function save() {
  await chrome.storage.local.set({
    baseUrl: $("baseUrl").value.trim() || DEFAULTS.baseUrl,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULTS.model,
    systemPrompt: $("systemPrompt").value.trim() || DEFAULTS.systemPrompt,
    thinking: $("thinking").value,
  });
  const status = $("status");
  status.textContent = "✓ 已保存";
  setTimeout(() => (status.textContent = ""), 2000);
}

// 思考模式 → 请求参数（DeepSeek 推理模型专用；default 时不带任何额外参数）
function thinkingParams(mode) {
  if (mode === "low") return { reasoning_effort: "low" };
  if (mode === "off") return { thinking: { type: "disabled" } };
  return {};
}

$("save").addEventListener("click", save);
$("resetPrompt").addEventListener("click", () => {
  $("systemPrompt").value = DEFAULT_SYSTEM_PROMPT;
});

// ---- 测试连接 ----
// 用当前表单里的值（不要求先保存）发一条最短的非流式请求，验证 Base URL / Key / 模型

function showTestResult(text, kind) {
  const el = $("testResult");
  el.textContent = text;
  el.className = kind || "";
}

$("test").addEventListener("click", async () => {
  const baseUrl = ($("baseUrl").value.trim() || DEFAULTS.baseUrl).replace(
    /\/+$/,
    ""
  );
  const apiKey = $("apiKey").value.trim();
  const model = $("model").value.trim() || DEFAULTS.model;

  if (!apiKey) {
    showTestResult("请先填写 API Key", "fail");
    return;
  }

  const btn = $("test");
  btn.disabled = true;
  showTestResult("测试中…", "pending");
  const t0 = performance.now();

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        // 推理模型（如 deepseek 系列）的 reasoning 也占 token，给足余量
        max_tokens: 512,
        messages: [{ role: "user", content: "hello" }],
        ...thinkingParams($("thinking").value),
      }),
    });
    const ms = Math.round(performance.now() - t0);
    const text = await resp.text();

    if (!resp.ok) {
      showTestResult(
        `✗ HTTP ${resp.status}：${text.slice(0, 200)}`,
        "fail"
      );
      return;
    }

    let reply = null;
    try {
      const msg = JSON.parse(text).choices?.[0]?.message;
      // 推理模型可能把输出放在 reasoning_content 里，content 为空时回退读它
      reply = msg?.content?.trim() || msg?.reasoning_content?.trim();
    } catch {
      // 不是合法 JSON
    }
    if (reply) {
      showTestResult(
        `✓ 连接成功（${ms}ms），模型回复：${reply.slice(0, 80)}`,
        "ok"
      );
    } else {
      showTestResult(
        `✗ 请求成功但解析不到回复内容：${text.slice(0, 200)}`,
        "fail"
      );
    }
  } catch (e) {
    showTestResult(
      `✗ 网络请求失败：${e.message}（检查 Base URL 是否可访问）`,
      "fail"
    );
  } finally {
    btn.disabled = false;
  }
});

restore();
