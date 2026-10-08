// Lingo background service worker
// 职责：右键菜单（每个 profile 一个入口） + 代理所有 API 请求（content script 直接请求会有 CORS 和暴露 key 的问题）

importScripts("profiles.js");

const DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

const MENU_PREFIX = "lingo-ask:";

// ---- 右键菜单 ----

async function rebuildMenus() {
  const { profiles } = await LingoProfiles.load();
  await chrome.contextMenus.removeAll();
  for (const p of profiles) {
    chrome.contextMenus.create({
      id: `${MENU_PREFIX}${p.id}`,
      title: `问 Lingo：${p.name}`,
      contexts: ["selection"],
    });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void rebuildMenus();
});

// service worker 重启后菜单还在，但 onStartup 重建一次作为自愈
chrome.runtime.onStartup.addListener(() => {
  void rebuildMenus();
});

// 设置页增删/改名 profile 后即时重建菜单
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.profiles || changes.defaultProfileId)) {
    void rebuildMenus();
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (
    typeof info.menuItemId !== "string" ||
    !info.menuItemId.startsWith(MENU_PREFIX) ||
    tab?.id == null
  ) {
    return;
  }
  const tabId = tab.id;
  const profileId = info.menuItemId.slice(MENU_PREFIX.length);

  chrome.tabs.sendMessage(tabId, { type: "lingo:open", profileId }, async () => {
    if (!chrome.runtime.lastError) return; // content script 正常响应

    // content script 不在（页面先于插件安装/重载打开），现场注入再重试
    try {
      await chrome.scripting.insertCSS({
        target: { tabId },
        files: ["content.css"],
      });
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["profiles.js", "content.js"],
      });
      chrome.tabs.sendMessage(tabId, { type: "lingo:open", profileId }, () => {
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
    "thinking",
  ]);

  // profile 决定本次提问用哪套 system prompt（过期 id 兜底到默认）
  const { profiles, defaultProfileId } = await LingoProfiles.load();
  const profile = LingoProfiles.pick(profiles, defaultProfileId, payload?.profileId);
  const systemPrompt =
    profile.systemPrompt ||
    LingoProfiles.presetById(profile.id)?.systemPrompt ||
    "";

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
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        // 思考模式（DeepSeek 等推理模型专用）：low → reasoning_effort，off → thinking disabled
        ...(cfg.thinking === "low"
          ? { reasoning_effort: "low" }
          : cfg.thinking === "off"
            ? { thinking: { type: "disabled" } }
            : {}),
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
