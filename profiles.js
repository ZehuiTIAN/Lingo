// Lingo 共享 profile 模块
// 三个环境共用：background（importScripts）、content script（manifest 里先注入）、options 页（<script> 标签）
// 挂载到 self 上 + 幂等守卫，重复注入安全（content script 可能被多次注入）

self.LingoProfiles = self.LingoProfiles || (() => {
  const PRESETS = [
    {
      id: "lang",
      name: "学语言",
      systemPrompt: [
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
      ].join("\n"),
    },
    {
      id: "philo",
      name: "哲学社科",
      systemPrompt: [
        "You are a context-aware humanities and social sciences tutor.",
        "",
        "Always answer primarily in Simplified Chinese, regardless of the language of the selected text. When introducing a concept, keep the original term alongside its Chinese translation.",
        "",
        "When I select a term, concept, name, or passage from a webpage, explain it based on its specific context rather than giving only a textbook definition.",
        "",
        "Focus on:",
        "- what the concept means here, in this author's usage;",
        "- the school of thought or discipline it belongs to, and its key thinkers or representative works;",
        "- its core claims, and why it matters;",
        "- common misunderstandings or conflation with adjacent concepts;",
        "- how the surrounding passage uses it — defining, applying, endorsing, or criticizing;",
        "- one or two concrete examples when useful.",
        "",
        "If I select a full sentence or passage, first explain the overall point in plain language, then unpack the concepts it relies on.",
        "",
        "If a term has different meanings across disciplines or schools, prioritize the one that fits the webpage context and mention alternatives only when useful.",
        "",
        "Be concise and precise. Avoid stacking jargon; explain any technical term you must use. Adapt to a curious reader with a general education, not a specialist.",
      ].join("\n"),
    },
  ];

  // 读取 profiles + defaultProfileId。
  // 迁移逻辑：无 profiles 但有旧版单 systemPrompt key → 迁到「学语言」上，其余用内置模板补齐；
  // 两者都没有 → 返回内置模板。保证返回非空数组。
  async function load() {
    const cfg = await chrome.storage.local.get([
      "profiles",
      "defaultProfileId",
      "systemPrompt", // 旧版遗留 key
    ]);

    let profiles = Array.isArray(cfg.profiles)
      ? cfg.profiles.filter((p) => p && p.id && p.name)
      : [];

    if (profiles.length === 0) {
      if (cfg.systemPrompt) {
        profiles = PRESETS.map((p) =>
          p.id === "lang" ? { ...p, systemPrompt: cfg.systemPrompt } : { ...p }
        );
      } else {
        profiles = PRESETS.map((p) => ({ ...p }));
      }
    }

    const defaultProfileId =
      cfg.defaultProfileId && profiles.some((p) => p.id === cfg.defaultProfileId)
        ? cfg.defaultProfileId
        : profiles[0].id;

    return { profiles, defaultProfileId };
  }

  // 按 id 取 profile，fallback 链：指定 id → 默认 → 第一个
  function pick(profiles, defaultProfileId, profileId) {
    return (
      profiles.find((p) => p.id === profileId) ||
      profiles.find((p) => p.id === defaultProfileId) ||
      profiles[0]
    );
  }

  function presetById(id) {
    return PRESETS.find((p) => p.id === id) || null;
  }

  return { PRESETS, load, pick, presetById };
})();
