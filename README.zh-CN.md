# pi-codeblocks

为 [Pi](https://pi.dev) 编程智能体的终端界面添加带边框、语言标签、语法高亮和复制按钮的 Markdown 代码块。

[English](README.md) · [한국어](README.ko.md) · [日本語](README.ja.md) · **简体中文** · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md)

![Pi 中带边框、语法高亮和复制按钮的 TypeScript 代码块预览](assets/code-block-preview.png)

需要 Node.js 22.19.0 及以上版本和 Pi 0.79.9 及以上版本。复制与 Markdown 修复从 Pi 0.85.1 开始验证。Pi 0.79.9 和 0.80.3 仅显示边框。

## 安装

```bash
pi install /path/to/pi-codeblocks  # 本地检出目录
pi install npm:pi-codeblocks       # npm 发布后
```

重启 Pi 或运行 `/reload`。无需安装即可试用：`pi -e /path/to/pi-codeblocks/extensions/code-blocks.ts`。卸载时使用 `pi remove`，并指定与安装时相同的来源。

## 复制代码

- **鼠标：** 在全屏模式下，已生成完毕的非空代码块拥有至少 24 列可用空间时才会显示 `[Copy]`。复制成功后，只有被点击的按钮会显示 `[Copied!]`，持续 1.5 秒。拖动仍然选择屏幕上的文本。
- **键盘：** `/codeblocks copy` 复制当前分支最新助手回复中的第一个非空代码块，包括引用和列表内的代码块。编号从回复顶部开始，因此 `/codeblocks copy 2` 复制第二个。编号无效、超出范围或回复中没有代码时，不会改动剪贴板。仅支持常规和全屏 TUI，不支持 RPC、JSON 或打印模式。
- **复制内容：** 保留换行和缩进；制表符变为 Pi 显示的三个空格。复制结果不包含代码围栏、边框填充或终端控制字符。两种方式都使用 Pi 的代码块解析与剪贴板功能，按请求顺序写入。

## Markdown 修复

只在显示已完成的助手回复时修复单行代码围栏，并将识别到的 Shell 命令框转换为代码块。保留内部反引号及 `python -m pytest`、`go test ./...` 中的可执行文件名。含块级公式的回复、跨行的行内代码中的文本框，以及反斜杠后空格含义不明确的文本框保持原样。扩展不会执行代码或更改已保存的消息。

## 选项

在启动 Pi 前设置环境变量。未设置或为空时使用默认值。`0`、`false`、`no`、`off` 表示关闭，不区分大小写；其他非空值表示开启。

| 变量 | 默认值 | 开启后 |
|---|---|---|
| `PI_CODEBLOCKS_LANG` | 开 | 显示 JavaScript、TypeScript、Text 等格式名称 |
| `PI_CODEBLOCKS_COPY` | 开 | 启用鼠标复制按钮，不影响键盘复制 |
| `PI_CODEBLOCKS_FILL` | 关 | 用 Pi 主题的中性工具背景色填充 |
| `PI_CODEBLOCKS_ASCII` | 关 | 边框使用 `+`、`-`、`\|`，截断时使用 `...` |
| `PI_CODEBLOCKS_BAR` | 关 | 仅保留上边框，让代码占满可用宽度 |

## 兼容性

使用 Pi 的语法高亮和主题颜色，长行按代码块的可用宽度换行。Mermaid 和宽度不足 12 列的代码块保留 Pi 的标准显示。边框依赖 Pi 的私有方法 `Markdown.prototype.renderToken`，不可用时回退为 Pi 的标准显示。请勿同时开启多个代码块渲染扩展。

已在 macOS ARM64、Node.js 26 下测试 Pi 0.79.9、0.80.3、0.85.1、1.3.0、1.4.0 和 1.5.0–1.5.2。[兼容性工作流](https://github.com/stellarsailor/pi-codeblocks/actions/workflows/compatibility.yml) 覆盖 macOS、Linux 和 Windows，不验证实际鼠标点击或桌面剪贴板。

## 开发

```bash
npm install       # 安装 TypeScript 和 Node 类型
npm test          # 使用本地或全局安装的 Pi
npm run typecheck # 需要本地安装的 Pi 提供类型
```

MIT · [更新记录](CHANGELOG.md)
