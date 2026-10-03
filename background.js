// Lingo background service worker
// 职责：右键菜单 + 代理所有 API 请求（content script 直接请求会有 CORS 和暴露 key 的问题）

const DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
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
};

// ---- 右键菜单 ----

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "lingo-ask",
    title: "问 Lingo：解释这段英文",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "lingo-ask" || tab?.id == null) return;
  const tabId = tab.id;

  chrome.tabs.sendMessage(tabId, { type: "lingo:open" }, async () => {
    if (!chrome.runtime.lastError) return; // content script 正常响应

    // content script 不在（页面先于插件安装/重载打开），现场注入再重试
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"],
      });
      chrome.tabs.sendMessage(tabId, { type: "lingo:open" }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // 注入失败的页面（chrome://、Chrome 应用商店、内置 PDF 阅读器等），无法支持
    }
  });
});

// ---- API 流式代理 ----
// content.js 通过 Port 发来查询，这里 fetch SSE 并把增量逐块推回去

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "lingo-query") return;

  const controller = new AbortController();
  port.onDisconnect.addListener(() => controller.abort());

  port.onMessage.addListener((msg) => {
    if (msg?.type === "query") {
      handleQuery(port, msg.payload, controller.signal);
    }
  });
});

async function handleQuery(port, payload, signal) {
  const post = (msg) => {
    try {
      port.postMessage(msg);
    } catch {
      // 面板已关闭
    }
  };

  const t0 = performance.now();

  const cfg = await chrome.storage.local.get([
    "baseUrl",
    "apiKey",
    "model",
    "systemPrompt",
  ]);

  const t1 = performance.now(); // 配置读取完成

  if (!cfg.apiKey) {
    post({
      type: "error",
      message:
        "还没有设置 API Key。请点击浏览器右上角 Lingo 图标 →「选项」，或在扩展管理页打开「扩展程序选项」进行设置。",
    });
    return;
  }

  const baseUrl = (cfg.baseUrl || DEFAULTS.baseUrl).replace(/\/+$/, "");
  const userMessage = `【划选内容】\n${payload.selection}\n\n【上下文】\n${payload.context || "(无)"}`;

  let resp;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model || DEFAULTS.model,
        stream: true,
        messages: [
          { role: "system", content: cfg.systemPrompt || DEFAULTS.systemPrompt },
          { role: "user", content: userMessage },
        ],
      }),
    });
  } catch (e) {
    if (e.name !== "AbortError") {
      post({ type: "error", message: `网络请求失败：${e.message}\n请检查 Base URL 是否正确、网络是否可连通。` });
    }
    return;
  }

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => "");
    post({
      type: "error",
      message: `API 返回错误（HTTP ${resp.status}）：\n${text.slice(0, 500)}`,
    });
    return;
  }

  const t2 = performance.now(); // 收到响应头（首字节），服务器开始流式输出

  // 解析 SSE：每行形如 "data: {...}"，结束时为 "data: [DONE]"
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let tFirst = null; // 第一个内容 token 到达时间

  const finish = () => {
    const now = performance.now();
    const stats = {
      configMs: Math.round(t1 - t0),
      ttfbMs: Math.round(t2 - t1),
      firstTokenMs: tFirst == null ? null : Math.round(tFirst - t2),
      streamMs: tFirst == null ? null : Math.round(now - tFirst),
      totalMs: Math.round(now - t0),
    };
    console.log("[lingo] timing", stats);
    post({ type: "done", stats });
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          finish();
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            if (tFirst === null) tFirst = performance.now();
            post({ type: "chunk", delta });
          }
        } catch {
          // 忽略不完整的 JSON 块
        }
      }
    }
    finish();
  } catch (e) {
    if (e.name !== "AbortError") {
      post({ type: "error", message: `读取流时出错：${e.message}` });
    }
  }
}
