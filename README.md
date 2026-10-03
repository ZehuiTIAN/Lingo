# Lingo — 划词问 AI

一个极简的 Chrome 扩展：在网页上划选英文，一键问 AI 这段话在当前上下文中的意思、常见用法和例句。省去了复制粘贴到 ChatGPT 的步骤。

## 安装

1. 打开 Chrome，访问 `chrome://extensions/`
2. 打开右上角的「开发者模式」
3. 点击「加载已解压的扩展程序」，选择本项目文件夹（`Lingo/`）

## 首次使用前的配置（必做）

安装后打开设置页，任选一种方式：

- 在 `chrome://extensions/` 找到 Lingo →「详情」→「扩展程序选项」
- 或点击浏览器工具栏的 Lingo 图标旁边的菜单 →「选项」

需要填写的：

| 配置项 | 说明 |
|---|---|
| Base URL | 你的 OpenAI 兼容接口地址，填到 `/v1` 为止 |
| API Key | 你的密钥，只存在本机浏览器 |
| 模型 | 你的服务商提供的模型名 |
| System Prompt | **已内置默认值，不用改也能用**。想让回答风格更贴近你平时和 GPT 对话的习惯，就改这里 |

> 注意：API 调用没有 ChatGPT 网页版的记忆和自定义指令，你对回答格式的所有偏好都应该写进 System Prompt。

## 使用

- **划选**任意英文 → 点击浮出的「问 AI」按钮
- 或者划选后**右键** →「问 Lingo：解释这段英文」
- 回答流式显示在浮窗里，`Esc` 关闭，「复制」可拷走回答

## 文件结构

```
manifest.json   插件清单
background.js   右键菜单 + API 流式代理（SSE）
content.js      划选监听、浮窗 UI、流式渲染
content.css     浮窗样式
options.html/js 设置页（Base URL / API Key / 模型 / System Prompt）
```

## 后续可能的扩展

- Markdown 渲染回答
- 浮窗内多轮追问
- 生词本（保存问过的表达）
- Safari 版本（可先用 `xcrun safari-web-extension-converter` 转换试试）
