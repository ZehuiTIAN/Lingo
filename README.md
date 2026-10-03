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

## 数据存储与安全性

### 配置存在哪里

Base URL、API Key、模型、System Prompt 都通过 `chrome.storage.local` 存储，这是 Chrome 为每个扩展提供的持久化本地存储，写在磁盘上的浏览器用户目录里（大致在 `%LocalAppData%\Google\Chrome\User Data\Default\Local Extension Settings\<扩展ID>\`）。

### 什么情况下配置会丢

| 操作 | 配置会丢吗 |
|---|---|
| 在 `chrome://extensions/` 点「重载」 | ❌ 不会 |
| 重启浏览器 / 重启电脑 | ❌ 不会 |
| 修改插件代码后重载 | ❌ 不会 |
| **移除（卸载）扩展** | ✅ 会被 Chrome 一并删除 |
| **移动/重命名本文件夹**后重新加载 | ⚠️ 会读不到——Chrome 按文件夹路径生成扩展 ID，路径变了就被当成新扩展 |

所以文件夹位置定了之后不要挪。

### 安全性

- **API Key 只存在你本机**，插件没有任何外发行为。代码中唯一的网络请求就是发给你自己配置的 Base URL（见 `background.js` 的 `handleQuery`）。
- **Key 在本机是明文可读的**。能接触你电脑浏览器的人理论上可以翻出来。个人自用没问题。
- **不要把你配好 key 的插件文件夹原样分享给别人**。分享代码时请对方填自己的 API key。
- 回答面板的 Markdown 渲染是「先整体 HTML 转义、再做 Markdown 转换」，模型返回的 HTML/脚本只会显示为纯文本，不会在页面里执行。

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
