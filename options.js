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
  ]);
  $("baseUrl").value = cfg.baseUrl ?? "";
  $("apiKey").value = cfg.apiKey ?? "";
  $("model").value = cfg.model ?? "";
  $("systemPrompt").value = cfg.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
}

async function save() {
  await chrome.storage.local.set({
    baseUrl: $("baseUrl").value.trim() || DEFAULTS.baseUrl,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULTS.model,
    systemPrompt: $("systemPrompt").value.trim() || DEFAULTS.systemPrompt,
  });
  const status = $("status");
  status.textContent = "✓ 已保存";
  setTimeout(() => (status.textContent = ""), 2000);
}

$("save").addEventListener("click", save);
$("resetPrompt").addEventListener("click", () => {
  $("systemPrompt").value = DEFAULT_SYSTEM_PROMPT;
});

restore();
