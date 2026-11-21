import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import { copyToClipboard, getMarkdownTheme, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";

const { Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } = tui;

const PATCH = Symbol.for("pi-codeblocks.renderer");
const STATE = Symbol.for("pi-codeblocks.state");
const MIN_WIDTH = 12;
const COPY_MIN_WIDTH = 24;
const SIDES_MIN_WIDTH = 40;
const BORDERLESS_LABEL = "[Borderless]";
const BORDERED_LABEL = "[Bordered]";
const BORDER_LABEL_WIDTH = BORDERLESS_LABEL.length;
const COPY_LABEL = "[Copy]";
const COPIED_LABEL = "[Copied!]";
const COPY_GROWTH = COPIED_LABEL.length - COPY_LABEL.length;
const COPIED_MS = 1500;
const COPY_TIMEOUT_MS = 10_000;
const WIDGET = "pi-codeblocks.copy";
// A zero-width marker anchors the actual button after Pi applies margins and wrapping.
const MARKER_PREFIX = `\x1b_pi-codeblocks:${randomUUID()}:`;
const MARKER = new RegExp(`${MARKER_PREFIX}(\\d+)\x07`, "g");
// Match a CSI sequence's final byte so stripping it cannot eat the next printable character.
const TERMINAL_SEQUENCE = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|(?:\x1b[\]PX^_]|[\x90\x98\x9d-\x9f])[^\x07\x1b\x9c]*(?:\x07|\x9c|\x1b\\)/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const ALIASES = new Map(Object.entries({
  cts: "typescript", env: "properties", fish: "bash", jsonc: "json", mts: "typescript", node: "javascript",
  proto: "protobuf", pwsh: "powershell", svelte: "html", terminal: "bash", vue: "html",
}));

/** How the frame labels a language: the format a reader recognises, not the fence word. */
const NAMES = new Map(Object.entries({
  bash: "Bash", c: "C", "c#": "C#", "c++": "C++", clojure: "Clojure", cpp: "C++", csharp: "C#", css: "CSS",
  cs: "C#", dart: "Dart", diff: "Diff", dockerfile: "Dockerfile", elixir: "Elixir", fish: "Fish", go: "Go", golang: "Go",
  graphql: "GraphQL", groovy: "Groovy", haskell: "Haskell", hcl: "HCL", html: "HTML", http: "HTTP",
  ini: "INI", java: "Java", javascript: "JavaScript", js: "JavaScript", json: "JSON", jsonc: "JSON",
  jsx: "JavaScript", kt: "Kotlin", kts: "Kotlin", kotlin: "Kotlin", lua: "Lua", makefile: "Makefile", markdown: "Markdown",
  md: "Markdown",
  nix: "Nix", objc: "Objective-C", objectivec: "Objective-C", perl: "Perl", php: "PHP", plaintext: "Text", powershell: "PowerShell",
  properties: "Properties", protobuf: "Protobuf", ps1: "PowerShell", pwsh: "PowerShell", py: "Python",
  python: "Python", r: "R", rb: "Ruby", rs: "Rust", ruby: "Ruby", rust: "Rust", scala: "Scala", scss: "SCSS", sh: "Shell",
  shell: "Shell", sql: "SQL", svelte: "Svelte", swift: "Swift", terminal: "Shell", text: "Text", tf: "HCL",
  toml: "TOML", ts: "TypeScript", tsx: "TypeScript", typescript: "TypeScript", vue: "Vue", xml: "XML",
  yaml: "YAML", yml: "YAML", zsh: "Zsh", console: "Shell", env: "Env", proto: "Protobuf",
}));

/** The fence word's own name, else the name of the grammar its alias maps to, else the word itself. */
function displayName(lang: string): string {
  const lower = lang.toLowerCase();
  return NAMES.get(lower) ?? NAMES.get(ALIASES.get(lower) ?? "") ?? lang;
}

type Theme = tui.MarkdownTheme;

interface Token {
  type?: string;
  lang?: unknown;
  text?: unknown;
}

interface CopyRegion {
  row: number;
  col: number;
  width: number;
  offset: number;
  text: string;
  index: number;
  controls: string;
  toggleCol?: number;
}

interface State {
  handlers: Handlers;
  fullscreen: boolean;
  copying: boolean;
  ids: Map<number, string>;
  controls: Map<number, string>;
  hiddenSides: Set<number>;
  nextId: number;
  regions: CopyRegion[];
  lines?: string[];
  copied?: CopyRegion;
  timer?: ReturnType<typeof setTimeout>;
}

interface MarkdownLike {
  theme: Theme;
  invalidate(): void;
  render(width: number): string[];
  renderToken(token: Token, width: number, next?: string, ...rest: unknown[]): string[];
  handleMouse?(event: tui.TuiMouseEvent): tui.TuiMouseEventResult | undefined;
  [STATE]?: State;
}

interface Handlers {
  token?: (this: MarkdownLike, token: Token, width: number, next?: string, ...rest: unknown[]) => string[] | undefined;
  draw?: (this: MarkdownLike, width: number) => string[];
  click?: (this: MarkdownLike, event: tui.TuiMouseEvent) => tui.TuiMouseEventResult | undefined;
}

interface Slot {
  handlers?: Handlers;
  original: {
    token: MarkdownLike["renderToken"];
    draw: MarkdownLike["render"];
    mouse?: MarkdownLike["handleMouse"];
  };
  screen?: tui.TUI;
  clipboard?: (text: string) => Promise<void>;
  clipboardWrite?: Promise<void>;
}

function clean(text: string): string {
  return stripVTControlCharacters(text.replace(TERMINAL_SEQUENCE, "")).replace(CONTROL, "");
}

function writeClipboard(slot: Slot, text: string): Promise<void> {
  const writer = slot.clipboard ?? copyToClipboard;
  // A backend that never settles must not wedge every later copy behind it.
  const write = () => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("clipboard did not respond")), COPY_TIMEOUT_MS);
    timer.unref?.();
    writer(text).then(
      () => { clearTimeout(timer); resolve(); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
  // The shared slot keeps an outstanding write in order even across /reload.
  const pending = slot.clipboardWrite ? slot.clipboardWrite.then(write, write) : write();
  slot.clipboardWrite = pending;
  const release = () => { if (slot.clipboardWrite === pending) slot.clipboardWrite = undefined; };
  void pending.then(release, release);
  return pending;
}

function highlightedLines(theme: Theme, code: string, lang: string): string[] {
  try {
    const lines = theme.highlightCode?.(code, ALIASES.get(lang) ?? (lang || undefined));
    if (lines?.length) return lines;
  } catch {
    // A custom Markdown highlighter can fail; keep the code visible.
  }
  return code.split("\n").map((line) => theme.codeBlock(line));
}

function rule(label: string, width: number, corners: string, dash: string, tag = ""): string {
  const name = label
    ? dash + truncateToWidth(` ${label} `, Math.max(1, width - 4 - visibleWidth(tag)), dash === "-" ? "..." : "…")
    : "";
  const fill = Math.max(0, width - 2 - visibleWidth(name) - visibleWidth(tag));
  return `${corners[0]}${name}${dash.repeat(fill)}${tag}${corners[1]}`;
}

const markdownParser = tui.Marked ? new tui.Marked() : undefined;
const ONE_LINE_FENCE = /^( {0,3})(`{3,})(?!`)([^\n]+?)\2[ \t]*$/gm;
const DISPLAY_MATH = /^ {0,3}(?:\$\$|\\\[)/m;
const GO_SUBCOMMAND = /^(?:bug|build|clean|doc|env|fix|fmt|get|help|install|list|mod|run|telemetry|test|tool|version|vet|work)(?:\s|$)/;
// shortcut: a closed list avoids treating an arbitrary command as a language; extend it for observed labels.
const LANGUAGES = new Set([
  "bash", "c", "c#", "c++", "clojure", "console", "cpp", "csharp", "css", "diff", "dockerfile", "elixir",
  "go", "graphql", "haskell", "html", "http", "ini", "java", "javascript", "js", "json", "jsx", "kotlin", "lua",
  "makefile", "markdown", "md", "objectivec", "perl", "php", "plaintext", "powershell", "ps1", "python", "py",
  "r", "ruby", "rust", "scala", "sh", "shell", "sql", "swift", "text", "toml", "ts", "tsx", "typescript", "xml",
  "yaml", "yml", "zsh",
]);

function normalizeOneLineFences(markdown: string): string {
  if (!markdownParser || !markdown.includes("```")) return markdown;
  if (markdown.replace(/\r\n?/g, "\n").search(ONE_LINE_FENCE) === -1) return markdown;
  return rewriteParagraphs(markdown, (raw, inline) => {
    const spans = new Map<number, string>();
    let offset = 0;
    for (const token of inline) {
      if (token.type === "codespan") spans.set(offset, token.raw);
      offset += token.raw.length;
    }
    return raw.replace(ONE_LINE_FENCE, (line, indent, fence, body, start) => {
      if (spans.get(start + indent.length) !== fence + body + fence) return line;
      const [word] = body.split(/[ \t]/, 1);
      const lower = word.toLowerCase();
      const rest = body.slice(word.length + 1);
      const args = rest.trimStart();
      const invocation = (SHELL.has(lower) && /^--?(?:[A-Za-z]|\s|$)/.test(args)) || (lower === "go" && GO_SUBCOMMAND.test(args));
      const known = !invocation && word.length < body.length && (LANGUAGES.has(lower) || ALIASES.has(lower));
      const code = known ? rest : body;
      return `${indent}${fence}${known ? word : ""}\n${indent}${code}\n${indent}${fence}`;
    });
  });
}

function rewriteParagraphs(markdown: string, rewrite: (raw: string, inline: tui.Token[]) => string): string {
  const source = markdown.replace(/\r\n?/g, "\n");
  const tokens = markdownParser!.lexer(source);
  if (tokens.map(({ raw }) => raw).join("") !== source) return markdown;
  // shortcut: leave replies with display math alone until repairs can use Pi's math ranges.
  if (tokens.some((token) => token.type === "paragraph" && DISPLAY_MATH.test(token.raw))) return markdown;
  const result = tokens.map((token) => token.type === "paragraph" ? rewrite(token.raw, token.tokens ?? []) : token.raw).join("");
  return result === source ? markdown : result;
}

const BOX_TOP = /^([\t ]*)[\u256d\u250c]([\u2500-]+)[\u256e\u2510][\t ]*$/;
const BOX_BOTTOM = /^([\t ]*)[\u2570\u2514]([\u2500-]+)[\u256f\u2518][\t ]*$/;
const BOX_ROW = /^([\t ]*)\u2502(.*)\u2502[\t ]*$/;
/** A diagram rather than a command list: arrows, tees and corners inside the box. */
const DIAGRAM = /[\u25b6\u25c0\u2192\u2190\u252c\u2534\u253c\u251c\u2524\u256d\u256e\u2570\u256f\u250c\u2510\u2514\u2518]/;
const SHELL = new Set([
  "awk", "bash", "brew", "bun", "cargo", "cat", "cd", "chmod", "chown", "cp", "curl", "date", "df",
  "dig", "docker", "du", "echo", "env", "export", "find", "fish", "git", "go", "grep", "head", "java", "jq", "kill",
  "kubectl", "ln", "ls", "lsof", "lua", "make", "mkdir", "mv", "nc", "node", "npm", "npx", "nvim", "open",
  "perl", "php", "pi", "pip", "pip3", "pnpm", "powershell", "ps", "psql", "pwd", "pwsh", "python", "python3",
  "redis-cli", "rm", "rsync", "ruby", "sed", "sh", "sleep", "sort", "source", "ssh", "sudo", "swift", "systemctl",
  "tail", "tar", "tee", "tmux", "touch", "uv",
  "vim", "wc", "wget", "which", "whoami", "xargs", "yarn", "yq", "zsh",
]);
const PROSE_VERB = new Set(["date", "find", "go", "head", "kill", "make", "open", "sort", "source", "tail", "touch"]);

/** Prefer `console` for prompt lines so Pi's shell grammar colours them the same way as a fence. */
function commandLanguage(lines: readonly string[]): string {
  return lines.some((line) => /^[$>] /.test(line.trim())) ? "console" : "bash";
}

/** Conservatively decide whether a box holds commands, so prose and diagram boxes are left alone. */
function looksLikeCommands(lines: readonly string[]): boolean {
  const content = lines.map((line) => line.trim()).filter(Boolean);
  if (content.length === 0) return false;
  if (content.some((line) => DIAGRAM.test(line))) return false;
  const shellish = content.filter((line) => {
    if (/^(?:\$\s|\/|~\/|\.\.?\/)/.test(line)) return true;
    const [word, ...args] = line.replace(/^[>#]\s+/, "").split(/\s+/);
    if (!SHELL.has(word)) return false;
    return !PROSE_VERB.has(word) || args.length === 0 ||
      ((word === "make" || word === "go") && args.length === 1) ||
      /\s(?:&&|\|\||\|)\s/.test(line) ||
      args.some((arg) => /^(?:--?\w|~(?:\/|$)|\.{1,2}(?:\/|$)|[A-Za-z_]\w*=)|[/\\]|\.[\w-]+$/.test(arg));
  }).length;
  return shellish * 2 > content.length;
}

/**
 * Use the same frame and copy path for command boxes and fenced blocks.
 */
function convertCommandBoxes(markdown: string): string {
  if (!markdownParser || !/[\u256d\u250c]/.test(markdown) || !markdown.includes("\u2502")) return markdown;
  return rewriteParagraphs(markdown, (raw, inline) => {
    // shortcut: leave the paragraph alone if inline markup crosses lines; use source ranges if mixed cases matter.
    return inline.some((token) => token.type !== "text" && token.type !== "br" && token.raw.includes("\n"))
      ? raw : convertBoxesInText(raw);
  });
}

function convertBoxesInText(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const top = BOX_TOP.exec(lines[index]);
    if (!top) {
      output.push(lines[index]);
      continue;
    }
    const indent = top[1];
    let end = index + 1;
    let ambiguousPadding = false;
    const body: string[] = [];
    for (; end < lines.length; end++) {
      if (BOX_BOTTOM.exec(lines[end])) break;
      const row = BOX_ROW.exec(lines[end]);
      if (!row || row[1] !== indent) break;
      const content = row[2].replace(/^ /, "");
      const line = content.trimEnd();
      // An escaped trailing space and a padded line continuation look identical in a box.
      ambiguousPadding ||= content !== line && ((/\\+$/.exec(line)?.[0].length ?? 0) % 2 === 1);
      body.push(line);
    }
    if (end >= lines.length || !BOX_BOTTOM.exec(lines[end])) {
      output.push(lines[index]);
      continue;
    }
    if (ambiguousPadding || !looksLikeCommands(body)) {
      for (let row = index; row <= end; row++) output.push(lines[row]);
      index = end;
      continue;
    }
    const longest = body.reduce((max, line) => {
      for (const run of line.matchAll(/`+/g)) max = Math.max(max, run[0].length);
      return max;
    }, 2);
    const fence = "`".repeat(longest + 1);
    output.push(`${indent}${fence}${commandLanguage(body)}`);
    for (const line of body) output.push(indent + line);
    output.push(indent + fence);
    index = end;
  }
  return output.join("\n");
}

/** What the transcript renders for a reply: command boxes become fences, then one-line fences are repaired. */
function displayMarkdown(markdown: string): string {
  return normalizeOneLineFences(convertCommandBoxes(markdown));
}

function codeMarker(id: number): string {
  return `${MARKER_PREFIX}${id}\x07`;
}

function lastReplyBlocks(session: ExtensionContext["sessionManager"], slot: Slot): string[] {
  const blocks: string[] = [];
  const entries = session.buildContextEntries?.() ?? session.getBranch();
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "message" || entry.message.role !== "assistant") continue;
    for (const part of entry.message.content) {
      if (part.type !== "text" || !part.text.trim()) continue;
      const markdown = new Markdown(displayMarkdown(part.text.trim()), 0, 0, getMarkdownTheme()) as unknown as MarkdownLike;
      const bodies: string[] = [];
      // Use Pi's tokenizer so math and partial fences are handled as on screen.
      markdown.renderToken = function (token, ...args) {
        if (token?.type !== "code" || typeof token.text !== "string") return slot.original.token.call(this, token, ...args);
        const text = clean(token.text);
        return text.trim() ? [codeMarker(bodies.push(text) - 1)] : [];
      };
      // A cached token can appear more than once; count each marker in output order.
      for (const line of slot.original.draw.call(markdown, 80)) {
        for (const [, id] of line.matchAll(MARKER)) {
          const body = bodies[Number(id)];
          if (body !== undefined) blocks.push(body);
        }
      }
    }
    break;
  }
  return blocks;
}

function canClick(event: tui.TuiMouseEvent): boolean {
  return event?.type === "click" && event.button === "left" && !event.shift && !event.alt && !event.ctrl;
}

function copyAt(state: State, event: tui.TuiMouseEvent): CopyRegion | undefined {
  if (!canClick(event)) return undefined;
  return state.regions.find((region) => event.y === region.row &&
    event.x >= region.col - (state.copied === region ? COPY_GROWTH : 0) && event.x < region.col + region.width);
}

function sidesAt(state: State, event: tui.TuiMouseEvent): CopyRegion | undefined {
  if (!canClick(event)) return undefined;
  return state.regions.find((region) => {
    if (region.toggleCol === undefined || event.y !== region.row) return false;
    const col = region.toggleCol - (state.copied === region ? COPY_GROWTH : 0);
    const labelWidth = state.hiddenSides.has(region.index) ? BORDERED_LABEL.length : BORDERLESS_LABEL.length;
    return event.x >= col && event.x < col + labelWidth;
  });
}

const OFF_VALUES = new Set(["0", "false", "no", "off"]);

/** Blank or missing keeps the default; `0`, `false`, `no` and `off` turn a flag off. */
function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value ? !OFF_VALUES.has(value) : fallback;
}

export default function codeBlocks(pi: ExtensionAPI) {
  const proto = Markdown.prototype as unknown as MarkdownLike & Record<PropertyKey, unknown>;
  const originalToken = proto.renderToken;
  const originalDraw = proto.render;
  const originalMouse = proto.handleMouse;
  if (typeof originalToken !== "function" || typeof originalDraw !== "function" || typeof proto.invalidate !== "function" || (
    !proto[PATCH] && (!Object.isExtensible(proto) || !Object.getOwnPropertyDescriptor(proto, "renderToken")?.writable)
  )) {
    let warned = false;
    pi.on("session_start", (_event, ctx) => {
      if (ctx.mode !== "tui" || warned) return;
      warned = true;
      ctx.ui.notify("pi-codeblocks: Markdown renderer unavailable; using Pi's default rendering.", "warning");
    });
    return;
  }

  let scope: { owner: MarkdownLike; state: State } | undefined;
  if (markdownParser) {
    pi.registerMarkdownTransformer?.((markdown, { messageType, isStreaming }) => {
      if (scope) {
        const copying = scope.state.fullscreen && !isStreaming;
        // Pi runs this hook before it looks up cached block lines.
        if (copying !== scope.state.copying) scope.owner.invalidate();
        scope.state.copying = copying;
      }
      return messageType === "assistant" && !isStreaming ? displayMarkdown(markdown) : markdown;
    }, { messageTypes: ["assistant", "assistant-thinking"] });
  }

  let attempt = 0;
  pi.registerCommand("codeblocks", {
    description: "Copy a code block from the last reply: /codeblocks copy [n]",
    handler: async (args, ctx) => {
      // Clipboard fallback can write terminal escapes to stdout, which RPC and JSON reserve for data.
      if (ctx.mode !== "tui") {
        ctx.ui.notify("pi-codeblocks: copy needs the interactive TUI", "warning");
        return;
      }
      const [action = "copy", count = "1", ...extra] = args.trim().split(/\s+/).filter(Boolean);
      const offset = Number(count);
      if (action !== "copy" || extra.length || !/^[1-9]\d*$/.test(count) || !Number.isSafeInteger(offset)) {
        ctx.ui.notify("Usage: /codeblocks copy [n] (n must be a positive integer)", "warning");
        return;
      }
      if (!markdownParser) {
        ctx.ui.notify("pi-codeblocks: /codeblocks needs Pi 0.85.1 or later", "warning");
        return;
      }
      const blocks = lastReplyBlocks(ctx.sessionManager, slot);
      if (blocks.length === 0) {
        ctx.ui.notify("pi-codeblocks: no code block in the last reply", "warning");
        return;
      }
      const text = blocks[offset - 1];
      if (text === undefined) {
        ctx.ui.notify(`pi-codeblocks: the last reply has ${blocks.length} code block(s)`, "warning");
        return;
      }
      attempt++;
      try {
        await writeClipboard(slot, text);
      } catch (error) {
        ctx.ui.notify(`pi-codeblocks: copy failed: ${error instanceof Error ? error.message : String(error)}`, "error");
        return;
      }
      ctx.ui.notify(`Copied code block ${offset} of ${blocks.length}`, "info");
    },
  });

  const showLang = flag("PI_CODEBLOCKS_LANG", true);
  const bar = flag("PI_CODEBLOCKS_BAR", false);
  const ascii = flag("PI_CODEBLOCKS_ASCII", false);
  const copyEnabled = flag("PI_CODEBLOCKS_COPY", true);
  const dash = ascii ? "-" : "─";
  const corners = ascii ? { top: "++", bottom: "++", wall: "|" } : { top: "╭╮", bottom: "╰╯", wall: "│" };
  // Reserve the longer label's cells without changing the right edge of the button.
  const copyTag = `${dash.repeat(COPY_GROWTH)} ${COPY_LABEL} `;
  // Keep the Copy button aligned even when the side-toggle label is shorter.
  const sidesTag = (hidden: boolean) =>
    `${dash.repeat(COPY_GROWTH)} ${(hidden ? BORDERED_LABEL : BORDERLESS_LABEL).padEnd(BORDER_LABEL_WIDTH)} ${COPY_LABEL} `;
  const fill = flag("PI_CODEBLOCKS_FILL", false);
  let background: (() => string | undefined) | undefined;
  let notifyCopyError: ((message: string) => void) | undefined;
  let registered = false;

  const existing = proto[PATCH] as Slot | undefined;
  const slot: Slot = existing ?? { original: { token: originalToken, draw: originalDraw, mouse: originalMouse } };
  slot.clipboard = copyToClipboard;
  slot.screen = undefined;
  if (!existing) {
    // Keep the wrappers in place so reload cannot remove another extension's wrapper.
    proto[PATCH] = slot;
    proto.renderToken = function (...args) {
      return slot.handlers?.token?.apply(this, args) ?? slot.original.token.apply(this, args);
    };
    proto.render = function (width) {
      if (slot.handlers?.draw) return slot.handlers.draw.call(this, width);
      if (this[STATE]) {
        clearTimeout(this[STATE].timer);
        delete this[STATE];
        this.invalidate();
      }
      return slot.original.draw.call(this, width);
    };
    proto.handleMouse = function (event) {
      return slot.handlers?.click?.call(this, event) ?? slot.original.mouse?.call(this, event);
    };
  }

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    if (fill) background = () => ctx.ui.theme.getBgAnsi?.("toolPendingBg");
    if (!copyEnabled || typeof tui.TuiAltScreen !== "function" || typeof pi.registerMarkdownTransformer !== "function") return;
    // A zero-row widget gives us Pi's live TUI reference without taking over the mouse.
    ctx.ui.setWidget(WIDGET, (screen) => {
      slot.screen = screen;
      return { render: () => [], invalidate() {} };
    }, { placement: "belowEditor" });
    registered = true;
    notifyCopyError = (message) => ctx.ui.notify(message, "error");
  });

  const handlers: Handlers = {};
  slot.handlers = handlers;
  const fullscreen = () => copyEnabled && slot.screen?.mode === "fullscreen";
  const redraw = () => {
    try {
      slot.screen?.requestRender();
    } catch {
      // Pi may have stopped the renderer while copying.
    }
  };

  handlers.token = function (token, width, next) {
    const theme = this.theme;
    if (token?.type !== "code" || typeof token.text !== "string" || !Number.isInteger(width) || width < MIN_WIDTH ||
      typeof theme?.codeBlock !== "function" || typeof theme.codeBlockBorder !== "function") return;
    const lang = clean(String(token.lang ?? "")).trim().split(/\s+/, 1)[0];
    const language = lang.toLowerCase();
    if (language === "mermaid") return;

    const code = clean(token.text);
    const active = scope?.owner === this ? scope.state : undefined;
    const index = active ? active.nextId++ : -1;
    const hiddenSides = !bar && active?.hiddenSides.has(index) === true;
    let tag = "";
    if (active?.copying && width >= COPY_MIN_WIDTH && code.trim()) {
      active.ids.set(index, code);
      const controls = !bar && width >= SIDES_MIN_WIDTH ? sidesTag(hiddenSides) : copyTag;
      active.controls.set(index, controls);
      tag = codeMarker(index) + controls;
    }

    const inner = bar || hiddenSides ? width : width - 4;
    const rows = highlightedLines(theme, code, language).flatMap((line) => wrapTextWithAnsi(line, inner));
    const top = theme.codeBlockBorder(rule(showLang ? displayName(lang) : "", width, corners.top, dash, tag));
    const wall = bar || hiddenSides ? "" : theme.codeBlockBorder(corners.wall);
    const bottom = theme.codeBlockBorder(rule("", width, corners.bottom, dash));
    let lines = bar ? [top, ...rows] : hiddenSides ? [top, ...rows, bottom] : [
      top,
      ...rows.map((row) => `${wall} ${row}${" ".repeat(Math.max(0, inner - visibleWidth(row)))} ${wall}`),
      bottom,
    ];
    const bg = background?.();
    if (bg && bg !== "\x1b[49m") {
      lines = lines.map((line) => {
        const pad = " ".repeat(Math.max(0, width - visibleWidth(line)));
        return `${bg}${line.replace(/\x1b\[(?:0|49)?m/g, `$&${bg}`)}${pad}\x1b[49m`;
      });
    }
    if (next && next !== "space") lines.push("");
    return lines;
  };

  handlers.draw = function (width) {
    const enabled = fullscreen();
    let state = this[STATE];
    if (!state || state.handlers !== handlers || state.fullscreen !== enabled) {
      clearTimeout(state?.timer);
      this.invalidate();
      state = this[STATE] = {
        handlers, fullscreen: enabled, copying: enabled, ids: new Map(), controls: new Map(),
        hiddenSides: new Set(), nextId: 0, regions: [],
      };
    }
    // Stable block indexes let each toggle survive invalidation and terminal resizing.
    state.nextId = 0;
    state.ids.clear();
    state.controls.clear();
    const previous = scope;
    scope = { owner: this, state };
    let lines: string[];
    try {
      lines = slot.original.draw.call(this, width);
    } finally {
      scope = previous;
    }
    if (lines !== state.lines) {
      const copiedIndex = state.copied ? state.regions.indexOf(state.copied) : -1;
      const copiedText = state.copied?.text;
      const regions: CopyRegion[] = [];
      const seen = new Set<number>();
      for (let row = 0; row < lines.length; row++) {
        const line = lines[row];
        if (!line.includes(MARKER_PREFIX)) continue;
        const match = line.matchAll(MARKER).next().value;
        if (!match) continue;
        lines[row] = line.replace(MARKER, "");
        const id = Number(match[1]);
        const text = state.ids.get(id);
        const controls = state.controls.get(id);
        const offset = match.index;
        if (text === undefined || controls === undefined || !line.startsWith(controls, offset + match[0].length)) continue;
        const col = visibleWidth(line.slice(0, offset)) + visibleWidth(controls) - COPY_LABEL.length - 1;
        const toggleCol = controls === copyTag ? undefined : col - BORDER_LABEL_WIDTH - 1;
        regions.push({ row, col, width: COPY_LABEL.length, offset, text, index: id, controls, toggleCol });
        seen.add(id);
      }
      for (const id of state.ids.keys()) if (!seen.has(id)) {
        state.ids.delete(id);
        state.controls.delete(id);
      }
      state.regions = regions;
      // A frame drawn again at another width keeps the feedback on the same block.
      const kept = copiedIndex >= 0 ? regions[copiedIndex] : undefined;
      state.copied = copiedText !== undefined && kept?.text === copiedText ? kept : undefined;
      if (!state.copied) clearTimeout(state.timer);
      state.lines = lines;
    }
    if (!state.copied) return lines;
    const { row, offset, controls } = state.copied;
    const line = lines[row];
    const feedback = lines.slice();
    feedback[row] = `${line.slice(0, offset)}${controls.slice(COPY_GROWTH).replace(COPY_LABEL, COPIED_LABEL)}${line.slice(offset + controls.length)}`;
    return feedback;
  };

  handlers.click = function (event) {
    const state = this[STATE];
    if (!fullscreen() || !state || state.handlers !== handlers) return;
    const toggle = sidesAt(state, event);
    if (toggle) {
      if (state.hiddenSides.has(toggle.index)) state.hiddenSides.delete(toggle.index);
      else state.hiddenSides.add(toggle.index);
      clearTimeout(state.timer);
      state.copied = undefined;
      this.invalidate();
      redraw();
      return { handled: true };
    }
    const region = copyAt(state, event);
    if (!region) return;
    const current = ++attempt;
    const stillVisible = () => current === attempt && slot.handlers === handlers && fullscreen() &&
      this[STATE] === state && state.regions.includes(region);
    void (async () => {
      try {
        await writeClipboard(slot, region.text);
      } catch (error) {
        if (stillVisible()) notifyCopyError?.(`pi-codeblocks: copy failed: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!stillVisible()) return;
      clearTimeout(state.timer);
      state.copied = region;
      state.timer = setTimeout(() => {
        state.copied = undefined;
        if (slot.handlers === handlers && this[STATE] === state) redraw();
      }, COPIED_MS);
      state.timer.unref?.();
      redraw();
    })();
    return { handled: true };
  };

  pi.on("session_shutdown", (_event, ctx) => {
    if (slot.handlers !== handlers) return;
    slot.handlers = undefined;
    slot.screen = undefined;
    if (!registered) return;
    registered = false;
    try {
      ctx.ui.setWidget(WIDGET, undefined);
    } catch {
      // A reload retires this ctx before shutdown reaches it.
    }
  });
}
