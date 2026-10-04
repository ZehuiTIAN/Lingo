// Lingo content script
// 职责：监听划选 → 显示浮动按钮 → 打开回答面板 → 通过 Port 接收流式回答

(() => {
  if (window.__lingoLoaded) return;
  window.__lingoLoaded = true;

  let askButton = null;
  let panel = null;
  let panelBody = null;
  let stickToBottom = false;
  let currentPort = null;
  let lastAnswer = "";

  // 插件重载/更新后，旧页面里残留的 content script 会失效：
  // 监听器还在，但一调 chrome.runtime API 就抛 "Extension context invalidated"
  function contextAlive() {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  }

  const CONTEXT_DEAD_HINT =
    "⚠️ 插件刚刚重载过，本页面里的旧脚本已失效。请刷新页面（F5）后再试。";

  // ---------- 极简 Markdown 渲染 ----------
  // 先整体 HTML 转义，再做 Markdown → HTML 转换，模型输出里的任何 HTML 都只会显示为文本

  function escapeHtml(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderMarkdown(src) {
    let text = escapeHtml(src);

    // 代码内容先提取为占位符，避免其中的字符被行内规则误转
    const stash = [];
    const keep = (html) => {
      stash.push(html);
      return `${stash.length - 1}`;
    };

    // 代码块 ```...```（流式输出时可能还没闭合，允许匹配到结尾）
    text = text.replace(/```[^\n]*\n?([\s\S]*?)(?:```|$)/g, (_, code) =>
      keep(`<pre><code>${code.replace(/\n$/, "")}</code></pre>`)
    );
    // 行内代码
    text = text.replace(/`([^`\n]+)`/g, (_, code) => keep(`<code>${code}</code>`));

    // 行内样式：先加粗后斜体
    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

    // 块级元素：逐行处理
    const out = [];
    let list = null; // "ul" | "ol" | null
    const closeList = () => {
      if (list) {
        out.push(`</${list}>`);
        list = null;
      }
    };

    for (const line of text.split("\n")) {
      let m;
      if ((m = line.match(/^(\d+)$/)) && stash[+m[1]]?.startsWith("<pre")) {
        closeList();
        out.push(m[1]); // 代码块占位符保持为独立块，不包 <p>
      } else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
        closeList();
        const level = Math.min(m[1].length, 4);
        out.push(`<h${level}>${m[2]}</h${level}>`);
      } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
        if (list !== "ul") {
          closeList();
          out.push("<ul>");
          list = "ul";
        }
        out.push(`<li>${m[1]}</li>`);
      } else if ((m = line.match(/^\s*\d+[.、)]\s+(.*)$/))) {
        if (list !== "ol") {
          closeList();
          out.push("<ol>");
          list = "ol";
        }
        out.push(`<li>${m[1]}</li>`);
      } else if (line.trim() === "") {
        closeList();
      } else {
        closeList();
        out.push(`<p>${line}</p>`);
      }
    }
    closeList();

    // 还原代码占位符
    let html = out.join("");
    stash.forEach((code, i) => {
      html = html.replace(`${i}`, code);
    });
    return html;
  }

  // ---------- 浮动「问 AI」按钮 ----------

  function ensureButton() {
    if (askButton) return askButton;
    askButton = document.createElement("button");
    askButton.className = "lingo-ask-btn";
    askButton.textContent = "问 AI";
    // mousedown 阻止默认行为，避免点击按钮时选区被清空
    askButton.addEventListener("mousedown", (e) => e.preventDefault());
    askButton.addEventListener("click", () => {
      const sel = window.getSelection();
      if (sel && sel.toString().trim()) {
        openPanel(sel.toString().trim(), getContext(sel));
      }
      hideButton();
    });
    document.documentElement.appendChild(askButton);
    return askButton;
  }

  function showButton(rect) {
    const btn = ensureButton();
    const top = rect.bottom + 8;
    let left = rect.left + rect.width / 2;
    btn.style.top = `${Math.max(4, top)}px`;
    // 粗略居中，防止超出右边界
    left = Math.min(Math.max(8, left - 30), window.innerWidth - 80);
    btn.style.left = `${left}px`;
    btn.style.display = "block";
  }

  function hideButton() {
    if (askButton) askButton.style.display = "none";
  }

  // ---------- 上下文提取 ----------

  function getContext(sel) {
    let node = sel.anchorNode;
    if (!node) return "";
    const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    const block =
      el?.closest("p, article, section, li, td, blockquote, div") ||
      document.body;
    let text = (block.innerText || "").replace(/\s+/g, " ").trim();

    const LIMIT = 1200;
    if (text.length <= LIMIT) return text;

    // 太长时以划选内容为中心截取
    const selected = sel.toString().trim();
    const idx = text.indexOf(selected);
    if (idx === -1) return `${text.slice(0, LIMIT)}…`;
    const start = Math.max(0, idx - Math.floor((LIMIT - selected.length) / 2));
    const end = Math.min(text.length, start + LIMIT);
    return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  }

  // ---------- 回答面板 ----------

  function ensurePanel() {
    if (panel) return;

    panel = document.createElement("div");
    panel.className = "lingo-panel";
    panel.innerHTML = `
      <div class="lingo-panel-header">
        <span class="lingo-panel-title" title=""></span>
        <span class="lingo-panel-actions">
          <button class="lingo-icon-btn lingo-copy" title="复制回答">复制</button>
          <button class="lingo-icon-btn lingo-close" title="关闭 (Esc)">✕</button>
        </span>
      </div>
      <div class="lingo-panel-body"></div>
      <div class="lingo-panel-status">思考中…</div>
    `;
    document.documentElement.appendChild(panel);

    panelBody = panel.querySelector(".lingo-panel-body");
    // 用户手动滚动时记录是否停在底部：只有贴着底部才跟随新内容自动下滚
    panelBody.addEventListener("scroll", () => {
      stickToBottom =
        panelBody.scrollHeight - panelBody.scrollTop - panelBody.clientHeight <
        24;
    });
    panel.querySelector(".lingo-close").addEventListener("click", closePanel);
    panel.querySelector(".lingo-copy").addEventListener("click", () => {
      navigator.clipboard.writeText(lastAnswer).catch(() => {});
    });

    // 阻止面板内的划选/点击事件冒泡到页面，避免误触"点击外部关闭"
    panel.addEventListener("mouseup", (e) => e.stopPropagation());
    panel.addEventListener("mousedown", (e) => e.stopPropagation());
  }

  function openPanel(selection, context) {
    ensurePanel();
    closeCurrentPort();

    panel.querySelector(".lingo-panel-title").textContent =
      selection.length > 40 ? `${selection.slice(0, 40)}…` : selection;
    panel.querySelector(".lingo-panel-title").title = selection;
    panelBody.textContent = "";
    panelBody.scrollTop = 0;
    stickToBottom = false;
    setStatus("思考中…");

    // 定位：跟随当前选区，否则居中
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && sel.toString().trim()) {
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      positionPanel(rect);
    } else {
      panel.style.top = "80px";
      panel.style.left = `${Math.max(16, (window.innerWidth - panel.offsetWidth) / 2)}px`;
    }
    panel.style.display = "flex";

    // 发起查询（先确认扩展上下文还活着）
    if (!contextAlive()) {
      panelBody.textContent = CONTEXT_DEAD_HINT;
      setStatus("");
      return;
    }
    try {
      currentPort = chrome.runtime.connect({ name: "lingo-query" });
    } catch {
      panelBody.textContent = CONTEXT_DEAD_HINT;
      setStatus("");
      return;
    }
    let answer = "";
    lastAnswer = "";
    let renderMs = 0;
    let renderCount = 0;
    currentPort.onMessage.addListener((msg) => {
      if (msg.type === "chunk") {
        answer += msg.delta;
        lastAnswer = answer;
        const r0 = performance.now();
        panelBody.innerHTML = renderMarkdown(answer);
        renderMs += performance.now() - r0;
        renderCount++;
        setStatus("");
        if (stickToBottom) {
          panelBody.scrollTop = panelBody.scrollHeight;
        }
      } else if (msg.type === "done") {
        setStatus(answer ? formatStats(msg.stats) : "（没有收到内容）");
        console.log(
          `[lingo] 本地渲染累计 ${Math.round(renderMs)}ms / ${renderCount} 次`
        );
      } else if (msg.type === "error") {
        setStatus("");
        panelBody.textContent = `⚠️ ${msg.message}`;
      }
    });
    currentPort.onDisconnect.addListener(() => {
      currentPort = null;
    });
    currentPort.postMessage({ type: "query", payload: { selection, context } });
  }

  function positionPanel(rect) {
    const PANEL_W = 420;
    let top = rect.bottom + 10;
    let left = rect.left;
    if (top + 300 > window.innerHeight) {
      top = Math.max(10, rect.top - 310); // 下方放不下就放上方
    }
    left = Math.min(Math.max(10, left), window.innerWidth - PANEL_W - 10);
    panel.style.top = `${top}px`;
    panel.style.left = `${left}px`;
  }

  function setStatus(text) {
    const el = panel?.querySelector(".lingo-panel-status");
    if (el) {
      el.textContent = text;
      el.style.display = text ? "block" : "none";
    }
  }

  function formatStats(s) {
    if (!s) return "";
    const fmt = (ms) =>
      ms == null ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
    return `首字节 ${fmt(s.ttfbMs)} · 首字 ${fmt(s.firstTokenMs)} · 生成 ${fmt(s.streamMs)} · 共 ${fmt(s.totalMs)}`;
  }

  function closeCurrentPort() {
    if (currentPort) {
      try {
        currentPort.disconnect();
      } catch {}
      currentPort = null;
    }
  }

  function closePanel() {
    closeCurrentPort();
    if (panel) panel.style.display = "none";
  }

  // ---------- 事件监听 ----------

  // 划选结束 → 显示按钮
  document.addEventListener("mouseup", (e) => {
    // 略等一拍，等浏览器完成选区更新
    setTimeout(() => {
      if (!contextAlive()) return; // 插件已重载，旧脚本停止响应
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) {
        hideButton();
        return;
      }
      const text = sel.toString().trim();
      // 忽略过短选择、输入框内的选择、以及我们自己面板里的选择
      if (text.length < 2) {
        hideButton();
        return;
      }
      const anchorEl =
        sel.anchorNode?.nodeType === Node.TEXT_NODE
          ? sel.anchorNode.parentElement
          : sel.anchorNode;
      if (anchorEl?.closest("input, textarea, [contenteditable], .lingo-panel")) {
        hideButton();
        return;
      }
      if (panel?.contains(e.target)) return;

      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      showButton(rect);
    }, 10);
  });

  // 点击页面其他地方 → 收起按钮
  document.addEventListener("mousedown", (e) => {
    if (askButton && !askButton.contains(e.target)) hideButton();
    if (panel && panel.style.display !== "none" && !panel.contains(e.target)) {
      // 点击面板外部不自动关闭面板（用户可能想边读边对照），只关按钮
    }
  });

  // Esc 关闭面板
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      hideButton();
      closePanel();
    }
  });

  // 右键菜单触发
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "lingo:open") {
      const sel = window.getSelection();
      if (sel && sel.toString().trim()) {
        openPanel(sel.toString().trim(), getContext(sel));
        hideButton();
      }
    }
  });
})();
