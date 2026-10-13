// Lingo 设置页逻辑
// profiles.js 通过 <script> 先于本文件加载，提供 LingoProfiles（内置模板 + 旧版迁移）

const DEFAULTS = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

const $ = (id) => document.getElementById(id);

// 编辑状态：profiles 是内存中的可编辑副本，切换 profile、点保存前都不写 storage
let profiles = [];
let defaultProfileId = null;
let currentProfileId = null;

function currentProfile() {
  return profiles.find((p) => p.id === currentProfileId) || profiles[0];
}

function presetPrompt(id) {
  return LingoProfiles.presetById(id)?.systemPrompt || "";
}

// 把 textarea 的内容写回内存里的 profile（保存前、切换前都要先 flush）
function flushPrompt() {
  const p = currentProfile();
  if (p) p.systemPrompt = $("systemPrompt").value;
}

function showProfile(id) {
  currentProfileId = id;
  const p = currentProfile();
  $("systemPrompt").value = p.systemPrompt || presetPrompt(p.id);
}

async function restore() {
  const cfg = await chrome.storage.local.get([
    "baseUrl",
    "apiKey",
    "model",
    "thinking",
  ]);
  $("baseUrl").value = cfg.baseUrl ?? "";
  $("apiKey").value = cfg.apiKey ?? "";
  $("model").value = cfg.model ?? "";
  $("thinking").value = cfg.thinking ?? "default";

  // 旧版单 systemPrompt key 的迁移在 LingoProfiles.load 里完成
  ({ profiles, defaultProfileId } = await LingoProfiles.load());
  currentProfileId = defaultProfileId;

  const sel = $("profile");
  for (const p of profiles) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
  sel.value = currentProfileId;
  showProfile(currentProfileId);
}

async function save() {
  flushPrompt();
  // 留空的 prompt 回退到内置模板，避免发出空 system message
  profiles = profiles.map((p) => ({
    ...p,
    systemPrompt: p.systemPrompt?.trim() ? p.systemPrompt : presetPrompt(p.id),
  }));
  await chrome.storage.local.set({
    baseUrl: $("baseUrl").value.trim() || DEFAULTS.baseUrl,
    apiKey: $("apiKey").value.trim(),
    model: $("model").value.trim() || DEFAULTS.model,
    thinking: $("thinking").value,
    profiles,
    defaultProfileId,
  });
  // 旧版 key 已迁移进 profiles，清掉以免混淆
  await chrome.storage.local.remove("systemPrompt");
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
$("profile").addEventListener("change", () => {
  flushPrompt(); // 先存住当前 profile 的未保存修改
  showProfile($("profile").value);
});
$("resetPrompt").addEventListener("click", () => {
  $("systemPrompt").value = presetPrompt(currentProfileId);
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
