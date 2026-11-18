const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { createRequire, findPackageJSON } = require("node:module");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const { stripVTControlCharacters } = require("node:util");

// Pi itself needs Node 22.19 or later; say so instead of failing later with a loader error.
const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 19)) {
  console.error(`pi-codeblocks: Pi needs Node >= 22.19.0, this is ${process.version}. ${os.platform()} ${process.arch}`);
  process.exit(1);
}

function installedPi() {
  const name = "@earendil-works/pi-coding-agent";
  try {
    return path.dirname(findPackageJSON(name, pathToFileURL(__filename)));
  } catch (error) {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }
  const { npm_execpath: npm, ...env } = process.env;
  // `npm --prefix <project> test` passes its local prefix to child commands.
  if (env.npm_config_prefix === env.npm_config_local_prefix) delete env.npm_config_prefix;
  const args = ["root", "-g"];
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const output = execFileSync(npm ? process.execPath : npmBin, npm ? [npm, ...args] : args, { encoding: "utf8", env });
  return path.join(output.trim(), name);
}

const piRoot = installedPi();
const fromPi = (file) => import(pathToFileURL(path.join(piRoot, "dist", file)));
const piRequire = createRequire(path.join(piRoot, "package.json"));
const tui = import(pathToFileURL(piRequire.resolve("@earendil-works/pi-tui")));
const EXTENSION = path.join(__dirname, "../extensions/code-blocks.ts");
const W = 64;

async function setup({ env = {}, context } = {}) {
  const { loadExtensions } = await fromPi("core/extensions/loader.js");
  const { initTheme, getMarkdownTheme, theme } = await fromPi("modes/interactive/theme/theme.js");
  const { Marked, Markdown, stripTerminalSequences = stripVTControlCharacters, TuiAltScreen, visibleWidth } = await tui;
  const flags = ["LANG", "FILL", "ASCII", "BAR", "COPY"].map((flag) => `PI_CODEBLOCKS_${flag}`);
  const values = { PI_CODEBLOCKS_COPY: "0", ...env }; // frame tests opt in to copy labels explicitly
  const saved = flags.map((key) => process.env[key]);
  function setEnv(key, value) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  flags.forEach((key) => setEnv(key, values[key]));
  const { extensions, errors } = await loadExtensions([EXTENSION], path.dirname(EXTENSION)).finally(() => {
    flags.forEach((key, index) => setEnv(key, saved[index]));
  });
  assert.deepEqual(errors, []);
  const [extension] = extensions;
  initTheme("dark", false);

  const screen = { mode: "fullscreen", requestRender() {} };
  const notifications = [];
  const cleared = [];
  const ui = {
    theme,
    notify: (...args) => notifications.push(args),
    setWidget: (key, factory) => {
      if (!factory) {
        cleared.push(key);
        return;
      }
      assert.deepEqual(factory(screen).render(), []);
    },
  };
  async function emit(type, ctx = { mode: "tui", ui }) {
    for (const handler of extension.handlers.get(type) ?? []) await handler({ type }, ctx);
  }
  await emit("session_start", context);
  const registration = extension.markdownTransformer;
  const transform = typeof registration === "function" ? registration : registration?.transformer;
  const slotOf = () => Markdown.prototype[Symbol.for("pi-codeblocks.renderer")];
  if (slotOf()) slotOf().clipboard = async () => {};
  return {
    emit, extension, initTheme, theme, visibleWidth, slotOf, screen, notifications, cleared, transform,
    hasParser: Boolean(Marked),
    hasMouse: Boolean(TuiAltScreen && transform),
    rows(text, width = W) {
      return new Markdown(text, 0, 0, getMarkdownTheme()).render(width);
    },
    plain(text, width = W) {
      return this.rows(text, width).map((line) => stripTerminalSequences(line).trimEnd());
    },
    render(markdown, { isStreaming = false, messageType = "assistant" } = {}) {
      return transform ? transform(markdown, { messageType, isStreaming, availableWidth: W }) : markdown;
    },
    /** A Markdown component kept alive across renders, as the transcript keeps it. */
    component(text = JS) {
      return new Markdown(text, 0, 0, getMarkdownTheme());
    },
  };
}

const JS_LINE = 'const hello = "\uC548\uB155";';
const JS = `\`\`\`js\n${JS_LINE}\n\`\`\``;
const TS = '```ts\nconst n: number = 1;\n```';
const JAVA = '```java\npublic class Demo { String s = "hi"; }\n```';

test("a fence becomes a labelled frame with no backticks left", async () => {
  const env = await setup();
  const plain = env.plain(JS);
  assert.match(plain[0], /^╭─ JavaScript ─+╮$/);
  assert.equal(plain[1].replace(/ +│$/, "│"), `│ ${JS_LINE}│`);
  assert.match(plain.at(-1), /^╰─+╯$/);
  assert.ok(!plain.some((line) => line.includes("```")));
});

test("supported languages are highlighted, not painted flat", async () => {
  const env = await setup();
  const foregrounds = (text) => new Set(env.rows(text).join("\n").match(/\x1b\[38;[0-9;]*m/g) ?? []).size;
  assert.ok(foregrounds(JAVA) > foregrounds("```java\nplain words here\n```"), "java keywords are coloured");
  assert.ok(foregrounds(TS) > 1);
});

test("aliases use nearby grammars without overriding Pi's native console grammar", async () => {
  const env = await setup();
  const { loadAllHighlightLanguages } = await fromPi("utils/syntax-highlight.js");
  await loadAllHighlightLanguages?.();
  const body = (lang, code) => env.rows(`\`\`\`${lang}\n${code}\n\`\`\``).slice(1, -1);
  const fish = 'if test -n "$x"\n  echo "hi"\nend';
  assert.deepEqual(body("fish", fish), body("bash", fish));
  assert.deepEqual(body("node", "const n = 1;"), body("js", "const n = 1;"));
  const session = "$ npm test\ntests passed";
  assert.deepEqual(body("console", session), body("shell", session));
  assert.notDeepEqual(body("console", session), body("bash", session));
  const unknown = env.plain("```made-up-lang\nsome text\n```");
  assert.match(unknown[0], /^╭─ made-up-lang ─+╮$/);
  assert.equal(unknown[1].replace(/^│ |\s*│$/g, ""), "some text");
});

test("a bare fence, an empty block and CRLF text all render", async () => {
  const env = await setup();
  assert.match(env.plain("```\nplain\n```")[0], /^╭─+╮$/, "a bare fence carries no label");
  assert.match(env.plain("```js\n```")[0], /^╭─ JavaScript ─+╮$/);
  assert.deepEqual(env.plain(JS.replaceAll("\n", "\r\n")), env.plain(JS));
});

test("blocks inside a quote and a list are framed at their own width", async () => {
  const env = await setup();
  for (const [name, source] of [
    ["quote", "> ```js\n> const x = 1;\n> ```"],
    ["numbered list", "1. Step:\n\n   ```ts\n   const n: number = 1;\n   ```"],
    ["bullet list", "- Step:\n\n  ```java\n  int n = 1;\n  ```"],
  ]) {
    const plain = env.plain(source);
    assert.ok(plain.some((line) => line.includes("╭")), `${name}: framed`);
    assert.ok(plain.some((line) => line.includes("╰")), `${name}: closed`);
    assert.ok(!plain.some((line) => line.includes("```")), `${name}: no fences`);
    assert.ok(plain.every((line) => env.visibleWidth(line) <= W), `${name}: fits`);
  }
});

test("two blocks in one reply each get their own frame", async () => {
  const env = await setup();
  const plain = env.plain(`${JS}\n\n${TS}`);
  assert.equal(plain.filter((line) => line.includes("╭")).length, 2);
  assert.equal(plain.filter((line) => line.includes("╰")).length, 2);
});

test("every row is exactly the width the caller offered, at any width", async () => {
  const env = await setup();
  const wideCode = `\`\`\`text\n${"a\uAC00\u{1F680}".repeat(80)}\n\`\`\``;
  for (const width of [12, 16, 24, 40, 63, 100, 180, 500]) {
    for (const source of [JS, wideCode]) {
      const rows = env.rows(source, width);
      assert.ok(rows.every((line) => env.visibleWidth(line) === width), `width ${width}`);
    }
  }
});

test("a long or wide language label cannot break the top rule", async () => {
  const env = await setup();
  for (const lang of ["\uAC00".repeat(12), "a-very-long-language-name"]) {
    for (const width of [12, 20, 40]) {
      const top = env.rows(`\`\`\`${lang}\ncode\n\`\`\``, width)[0];
      assert.equal(env.visibleWidth(top), width, `${lang} at ${width}`);
      assert.match(env.plain(`\`\`\`${lang}\ncode\n\`\`\``, width)[0], /^╭─ .*─+╮$/);
    }
  }
});

test("frames strip terminal sequences without swallowing the adjacent text", async () => {
  const env = await setup();
  const source = '```js\x1b]0;title\x07\nconst s = "\x1b]0;title\x07\x00\x9b";\n```';
  assert.deepEqual(env.rows(source), env.rows('```js\nconst s = "";\n```'));
  const expected = env.rows("```text\nbeforemessage\n```");
  for (const sequence of ["\x1b[?25l", "\x1b[5 q", "\x1b[38:2::12:34:56m", "\x9b?25l", "\x1b_fixture\x1b\\", "\x1bPfixture\x1b\\"]) {
    assert.deepEqual(env.rows(`\`\`\`text\nbefore${sequence}message\n\`\`\``), expected, JSON.stringify(sequence));
  }
});

test("Pi's own rendering is kept for Mermaid and for a width too narrow to frame", async () => {
  const env = await setup();
  const mermaid = env.plain("```mermaid\ngraph TD; A-->B;\n```");
  assert.ok(!mermaid.some((line) => line.includes("╭")), "mermaid is left to pi");
  const narrow = env.plain(JS, 8);
  assert.ok(!narrow.some((line) => line.includes("╭")), "too narrow: pi draws it");
});

test("ordinary Markdown and inline code are untouched", async () => {
  const env = await setup();
  const source = "**bold** and `inline` and ```` ```fence``` ````\n\n- item\n";
  assert.equal(env.render(source), source);
  const plain = env.plain("# Heading\n\nSome `code`.\n");
  assert.ok(plain.some((line) => line.includes("Heading")));
  assert.ok(!plain.some((line) => line.includes("╭")));
});

test("standalone one-line fences keep known labels and code indentation when the host has a parser", async () => {
  const env = await setup();
  if (!env.hasParser) {
    assert.equal(env.extension.markdownTransformer, undefined);
    assert.equal(env.render("```js x```"), "```js x```");
    return;
  }
  const cases = [
    ["java", "int n = 1;"], ["console", "$ npm test"], ["terminal", "$ echo hi"], ["Node", "const n = 1;"],
    ["http", "GET / HTTP/1.1"], ["makefile", "all:"], ["ini", "a=1"], ["c++", "int main() {}"],
    ["python", "    print(1)"], ["js", "console.log(`hello`)"], ["sh", "echo `date` "],
  ];
  for (const [lang, code] of cases) {
    assert.equal(env.render(`\`\`\`${lang} ${code}\`\`\`\n`), `\`\`\`${lang}\n${code}\n\`\`\`\n`, lang);
  }
  assert.equal(env.render("```npm test```\r\n"), "```\nnpm test\n```\n");
  for (const command of ["python -m pytest", "node --version", "bash -n build.sh", "java -version", "pwsh   -NoProfile", "go test ./..."]) {
    assert.equal(env.render(`\`\`\`${command}\`\`\``), `\`\`\`\n${command}\n\`\`\``, command);
  }
  assert.match(env.plain(env.render("```java int n = 1;```\n"))[0], /^╭─ Java ─+╮$/);
});

test("one-line repair does not rewrite existing blocks, inline spans or nested Markdown", async () => {
  const env = await setup();
  for (const source of [
    "````md\n```js x```\n````", "~~~md\n```js x```\n~~~", "<pre>\n```js x```\n</pre>",
    "use ```js x``` here\n", "use ````abc\n```js x```\ndef```` here\n", "> ```js x```\n",
    "- item\n\n  ```js x```\n", "    ```js x```\n", "```js const x = 1;\n",
    "Use ````code\n```js console.log(`hello`)```\nend```` here",
    "$$\n\\text{example}\n\n```js x```\n$$",
    "\\[\n```js x```\n\\]",
  ]) assert.equal(env.render(source), source);
  const mixed = "~~~md\n```js x```\n~~~\n\n```js y```";
  assert.equal(env.render(mixed), env.hasParser ? "~~~md\n```js x```\n~~~\n\n```js\ny\n```" : mixed);
});

test("only finished assistant Markdown is eligible for one-line repair", async () => {
  const env = await setup();
  const registration = env.extension.markdownTransformer;
  if (registration && typeof registration !== "function") assert.deepEqual([...registration.messageTypes], ["assistant", "assistant-thinking"]);
  const source = "```java int n = 1;```";
  assert.equal(env.render(source, { isStreaming: true }), source);
  assert.equal(env.render(source, { messageType: "user" }), source);
  assert.equal(env.render(source, { messageType: "assistant-thinking" }), source);
  assert.match(env.plain(JS)[0], /^╭─ JavaScript ─+╮$/);
});

test("reload keeps a subsequent renderer wrapper and updates the active configuration", async () => {
  const { Markdown } = await tui;
  const env = await setup();
  const ours = Markdown.prototype.renderToken;
  let calls = 0;
  const other = function (...args) {
    calls++;
    return ours.apply(this, args);
  };
  Markdown.prototype.renderToken = other;
  try {
    await env.emit("session_shutdown");
    assert.match(env.plain(JS)[0], /^```js$/);
    const reloaded = await setup({ env: { PI_CODEBLOCKS_LANG: "0" } });
    assert.equal(Markdown.prototype.renderToken, other);
    assert.match(reloaded.plain(JS)[0], /^╭─+╮$/);
    assert.equal(calls, 2);
  } finally {
    Markdown.prototype.renderToken = ours;
  }
});

test("a missing renderer warns once in the TUI without registering a transformer", async () => {
  const { Markdown } = await tui;
  const patched = Markdown.prototype.renderToken;
  const warnings = [];
  const ui = { notify: (...args) => warnings.push(args) };
  delete Markdown.prototype.renderToken;
  try {
    const env = await setup({ context: { mode: "rpc", ui } });
    assert.equal(env.extension.markdownTransformer, undefined);
    assert.deepEqual(warnings, []);
    await env.emit("session_start", { mode: "tui", ui });
    await env.emit("session_start", { mode: "tui", ui });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /default rendering/);
    assert.equal(warnings[0][1], "warning");
  } finally {
    Markdown.prototype.renderToken = patched;
  }
});

test("ASCII borders and truncated labels fit at narrow widths", async () => {
  const env = await setup({ env: { PI_CODEBLOCKS_ASCII: "1" } });
  const source = "```a-very-long-language\ncode\n```";
  assert.deepEqual(env.plain(source, 12), ["+- a-ve...-+", "| code     |", "+----------+"]);
  assert.ok(env.rows(source, 12).every((line) => env.visibleWidth(line) === 12));
});

test("bar mode retains indentation and uses the full width without side or bottom borders", async () => {
  const env = await setup({ env: { PI_CODEBLOCKS_ASCII: "1", PI_CODEBLOCKS_BAR: "1" } });
  const code = `  ${"x".repeat(10)}`;
  assert.deepEqual(env.plain(`\`\`\`text\n${code}\n\`\`\``, 12), ["+- Text ---+", code]);
});

test("fill follows light and dark backgrounds without hiding the frame", async () => {
  const env = await setup({ env: { PI_CODEBLOCKS_FILL: "1" } });
  const defaultRows = env.plain(JS);
  for (const name of ["dark", "light"]) {
    env.initTheme(name, false);
    const bg = env.theme.getBgAnsi("toolPendingBg");
    assert.match(bg, /^\x1b\[48;/);
    assert.notEqual(bg.replace("\x1b[48;", "\x1b[38;"), env.theme.getFgAnsi("mdCodeBlockBorder"));
    assert.ok(env.rows(JS).every((line) => line.startsWith(bg) && env.visibleWidth(line) === W));
    assert.deepEqual(env.plain(JS), defaultRows);
  }
  await env.emit("session_start", { mode: "tui", ui: { theme: { getBgAnsi: () => "\x1b[49m" } } });
  assert.ok(!env.rows(JS).some((line) => line.includes("\x1b[48;")));
  const plain = await setup();
  assert.ok(!plain.rows(JS).some((line) => line.includes("\x1b[48;")), "no shade by default");
});

const COPY = { PI_CODEBLOCKS_COPY: "1" };
const click = (region, overrides = {}) => ({
  type: "click", button: "left", x: region.col + 1, y: region.row,
  screenX: region.col + 1, screenY: region.row,
  width: W, height: 10, shift: false, alt: false, ctrl: false, ...overrides,
});

function regionsOf(component) {
  return component[Symbol.for("pi-codeblocks.state")]?.regions ?? [];
}

/** Let a clipboard promise chain settle; `setTimeout` may be mocked, `setImmediate` is not. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("a finished reply in fullscreen shows Copy only when the host can route clicks", async () => {
  const env = await setup({ env: COPY });
  const component = env.component();
  const plain = component.render(W).map((line) => stripVTControlCharacters(line).trimEnd());
  if (!env.hasMouse) {
    assert.match(plain[0], /^╭─ JavaScript ─+╮$/);
    assert.deepEqual(regionsOf(component), []);
    return;
  }
  assert.match(plain[0], /^╭─ JavaScript ─+ \[Copy\] ╮$/);
  assert.ok(!component.render(W)[0].includes("\x1b_pi-codeblocks:"));
  const [region] = regionsOf(component);
  assert.equal(region.row, 0);
  assert.equal(plain[0].slice(region.col), "[Copy] ╮");
  assert.equal(region.width, 6);
  assert.equal(region.text, JS_LINE);
  assert.ok(component.render(W).every((line) => env.visibleWidth(line) === W));
});

test("the copied text is the block body: fences, frame cells and padding are excluded", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  for (const [source, expected] of [
    ['```js\nconst a = 1;\n  return a;\n```', "const a = 1;\n  return a;"],
    ['```python\r\ndef f():\r\n    return 1\r\n```', "def f():\n    return 1"],
    // Pi collapses tabs to three spaces before lexing; the copy matches the rendered block.
    ['before\n\n```bash\n\techo hi\n```', "   echo hi"],
    ['> ```ts\n> const n = 1;\n> ```', "const n = 1;"],
    ['```text\nbefore\x07after\n\x1b[31m  indented\x1b[0m\n```', "beforeafter\n  indented"],
    ['```text\nbefore\x1b[?25lmessage\n```', "beforemessage"],
  ]) {
    const component = env.component(source);
    component.render(W);
    assert.equal(regionsOf(component)[0]?.text, expected, source);
  }
});

test("only the clicked block shows Copied! after the clipboard write succeeds", async (t) => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const written = [];
  let resolveWrite;
  env.slotOf().clipboard = (text) => {
    written.push(text);
    return new Promise((resolve) => { resolveWrite = resolve; });
  };
  const component = env.component(`${TS}\n\n${TS}`);
  component.render(W);
  const [first, second] = regionsOf(component);
  assert.equal(regionsOf(component).length, 2);
  assert.deepEqual(component.handleMouse(click(second)), { handled: true });
  assert.deepEqual(written, ["const n: number = 1;"]);
  assert.ok(!component.render(W).some((line) => line.includes("[Copied!]")), "still pending");

  resolveWrite();
  await flush();
  const copied = component.render(W).map((line) => stripVTControlCharacters(line).trimEnd());
  assert.match(copied[first.row], /\[Copy\] ╮$/, "identical body, different block");
  assert.match(copied[second.row], /^╭─ TypeScript ─+ \[Copied!\] ╮$/);
  assert.ok(component.render(W).every((line) => env.visibleWidth(line) === W));
  t.mock.timers.tick(2000);
  assert.ok(!component.render(W).some((line) => line.includes("[Copied!]")));
  assert.equal(regionsOf(component).length, 2);
});

test("the Copied! feedback follows its block when the frame is drawn at another width", async (t) => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const written = [];
  env.slotOf().clipboard = async (text) => written.push(text);
  const component = env.component(`${TS}\n\n${JS}`);
  component.render(W);
  const index = regionsOf(component).findIndex((region) => region.text === JS_LINE);
  assert.deepEqual(component.handleMouse(click(regionsOf(component)[index])), { handled: true });
  await flush();

  const wide = component.render(90);
  const rows = wide.map((line) => stripVTControlCharacters(line).trimEnd());
  const regions = regionsOf(component);
  assert.ok(wide.every((line) => env.visibleWidth(line) === 90));
  assert.match(rows[regions[index].row], /\[Copied!\] ╮$/);
  assert.match(rows[regions[1 - index].row], /\[Copy\] ╮$/);
  assert.deepEqual(component.handleMouse(click(regions[index])), { handled: true });
  await flush();
  assert.deepEqual(written, [JS_LINE, JS_LINE]);
});

test("clicks outside the label, other buttons, drags and modified clicks are ignored", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  const component = env.component();
  component.render(W);
  const [region] = regionsOf(component);
  for (const event of [
    click(region, { x: region.col - 1 }),
    click(region, { x: region.col + region.width }),
    click(region, { y: region.row + 1 }),
    click(region, { button: "right" }),
    click(region, { type: "press" }),
    click(region, { type: "release" }),
    click(region, { type: "drag" }),
    click(region, { shift: true }),
    click(region, { ctrl: true }),
  ]) assert.equal(component.handleMouse(event), undefined, JSON.stringify(event));
  assert.equal(component.handleMouse(undefined), undefined);
});

test("the real assistant renderer hides Copy until the message stops streaming", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  const { AssistantMessageComponent } = await fromPi("modes/interactive/components/assistant-message.js");
  const { getMarkdownTheme } = await fromPi("modes/interactive/theme/theme.js");
  const component = new AssistantMessageComponent(undefined, false, getMarkdownTheme(), "Thinking...", 1, [env.transform]);
  const message = { role: "assistant", content: [{ type: "text", text: JS }], stopReason: "stop" };
  component.updateContent(message, true);
  assert.ok(!component.render(W).some((line) => line.includes("[Copy]")));
  component.updateContent(message, false);
  assert.ok(component.render(W).some((line) => line.includes("[Copy]")), "same text after stream completion");
});

test("no label when copy is off or when the frame is too narrow", async () => {
  const off = await setup({ env: { PI_CODEBLOCKS_COPY: "0" } });
  const plainOff = off.component().render(W).map((line) => stripVTControlCharacters(line).trimEnd());
  assert.match(plainOff[0], /^╭─ JavaScript ─+╮$/);

  const narrow = await setup({ env: COPY });
  const narrowComponent = narrow.component();
  const rows = narrowComponent.render(23).map((line) => stripVTControlCharacters(line).trimEnd());
  assert.match(rows[0], /^╭─ JavaScript ─*╮$/);
  for (const width of [24, 40, 100]) {
    const wide = narrow.component();
    wide.render(width);
    assert.equal(regionsOf(wide).length, Number(narrow.hasMouse), `label at width ${width}`);
    assert.ok(wide.render(width).every((line) => narrow.visibleWidth(line) === width));
  }
});

test("ASCII and bar modes keep a copy label that fits the frame", async () => {
  const env = await setup({ env: { ...COPY, PI_CODEBLOCKS_ASCII: "1", PI_CODEBLOCKS_BAR: "1" } });
  const component = env.component();
  const plain = component.render(40).map((line) => stripVTControlCharacters(line).trimEnd());
  if (!env.hasMouse) {
    assert.match(plain[0], /^\+- JavaScript -+\+$/);
    return;
  }
  assert.match(plain[0], /^\+- JavaScript -+ \[Copy\] \+$/);
  const [region] = regionsOf(component);
  assert.equal(plain[0].slice(region.col), "[Copy] +");
  assert.deepEqual(component.handleMouse(click(region)), { handled: true });
});

test("a failed copy never claims success and shows an error instead", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  env.slotOf().clipboard = async () => { throw new Error("no clipboard"); };
  const component = env.component();
  component.render(W);
  assert.deepEqual(component.handleMouse(click(regionsOf(component)[0])), { handled: true });
  assert.ok(!component.render(W).some((line) => line.includes("[Copied!]")));
  await flush();
  assert.ok(!component.render(W).some((line) => line.includes("[Copied!]")));
  assert.deepEqual(env.notifications, [["pi-codeblocks: copy failed: no clipboard", "error"]]);
});

const BOX = [
  "Run this:",
  "",
  "╭──────────────────────────────────────────╮",
  "│ cd ~/Programming/project-palace &&       │",
  "│ python3 scripts/sync_mail.py --dry-run   │",
  "╰──────────────────────────────────────────╯",
  "",
  "Then check the log.",
].join("\n");

test("a command box in a reply becomes a framed block whose copy is the commands only", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasParser) {
    // Without Pi's exported Markdown parser a box cannot be recognised safely, so it stays as written.
    assert.equal(env.render(BOX), BOX);
    return;
  }
  const shown = env.render(BOX);
  assert.match(shown, /^Run this:\n\n```bash\ncd ~\/Programming\/project-palace &&\npython3 scripts\/sync_mail\.py --dry-run\n```\n\nThen check the log\.$/);
  const component = env.component(shown);
  const plain = component.render(56).map((line) => stripVTControlCharacters(line).trimEnd());
  assert.ok(plain.some((line) => /^╭─ Bash ─+ \[Copy\] ╮$/.test(line)));
  const [region] = regionsOf(component);
  assert.equal(region.text, "cd ~/Programming/project-palace &&\npython3 scripts/sync_mail.py --dry-run");
  assert.ok(!region.text.includes("│"));
  assert.ok(!plain.some((line) => line.includes("╭───")), "the original box art is replaced, not duplicated");
});

test("a clipboard write that never settles fails instead of blocking later copies", async (t) => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const written = [];
  let stuck = true;
  env.slotOf().clipboard = (text) => {
    if (stuck) return new Promise(() => {});
    written.push(text);
    return Promise.resolve();
  };
  const component = env.component(JS);
  component.render(W);
  assert.deepEqual(component.handleMouse(click(regionsOf(component)[0])), { handled: true });
  await flush();
  t.mock.timers.tick(10_000);
  await flush();
  assert.deepEqual(env.notifications.at(-1), ["pi-codeblocks: copy failed: clipboard did not respond", "error"]);
  assert.ok(!component.render(W).some((line) => line.includes("[Copied!]")));

  stuck = false;
  assert.deepEqual(component.handleMouse(click(regionsOf(component)[0])), { handled: true });
  await flush();
  assert.deepEqual(written, [JS_LINE]);
  assert.ok(component.render(W).some((line) => line.includes("[Copied!]")));
});

test("command boxes keep prompts, indentation and backticks intact", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasParser) return;
  const boxed = (...lines) => ["╭────╮", ...lines.map((line) => `│ ${line} │`), "╰────╯"].join("\n");
  const prompt = boxed("$ git status", "$ git log --oneline -3");
  assert.match(env.render(prompt), /^```console\n\$ git status\n\$ git log --oneline -3\n```$/);
  const indented = boxed("  npm test", "make build");
  assert.match(env.render(indented), /^```bash\n  npm test\nmake build\n```$/);
  const ticks = boxed("echo '```'", "grep x");
  assert.match(env.render(ticks), /^````bash\necho '```'\ngrep x\n````$/);
  const ambiguous = boxed("echo note\\   ", "echo next");
  assert.equal(env.render(ambiguous), ambiguous);
  assert.match(env.render(boxed("echo note\\\\   ", "echo next")), /^```bash\necho note\\\\\necho next\n```$/);
  // Idempotent: a second pass finds no box and changes nothing.
  assert.equal(env.render(env.render(BOX)), env.render(BOX));
});

test("prose, diagram, nested and unbalanced boxes are left exactly as written", async () => {
  const env = await setup({ env: COPY });
  for (const source of [
    "╭─────────────────╮\n│ This is a note  │\n╰─────────────────╯",
    "╭─────────────────╮\n│ a ──▶ b         │\n╰─────────────────╯",
    "```text\n╭──────────╮\n│ ls -la   │\n╰──────────╯\n```",
    "> ╭──────────╮\n> │ ls -la   │\n> ╰──────────╯",
    "╭──────────╮\n│ ls -la   │\n│ ls /tmp  │",
    "╭──────────╮\n├──────────┤\n│ ls -la   │\n╰──────────╯",
    "A sample: `start\n╭──────────────╮\n│ git status   │\n╰──────────────╯\nend`.",
    "A sample: **`start\n╭──────────────╮\n│ git status   │\n╰──────────────╯\nend`**.",
    "╭─────────────────────────╮\n│ make sure it is saved.  │\n╰─────────────────────────╯",
    "╭─────────────────────╮\n│ open the settings   │\n╰─────────────────────╯",
    "$$\n╭────────────╮\n│ git status │\n╰────────────╯\n$$",
  ]) assert.equal(env.render(source), source, source);
});

test("wide characters inside a command box still copy and fit", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasParser) return;
  const command = "echo '\uC548\uB155 \uD83D\uDE80' && ls ~/\uD504\uB85C\uC81D\uD2B8";
  const box = ["╭──────────────╮", `│ ${command} │`, "╰──────────────╯"].join("\n");
  const component = env.component(env.render(box));
  for (const width of [30, 48, 120]) {
    assert.ok(component.render(width).every((line) => env.visibleWidth(line) === width), `width ${width}`);
  }
  assert.equal(regionsOf(component)[0].text, command);
});

const entriesWith = (...texts) => ({
  getBranch: () => texts.map((text, index) => ({
    type: "message",
    id: String(index),
    message: { role: "assistant", content: [{ type: "text", text }] },
  })),
});

async function commandEnv(entries, mode = "tui") {
  const env = await setup({ env: COPY });
  const written = [];
  env.slotOf().clipboard = async (text) => written.push(text);
  const notify = [];
  const ctx = { mode, ui: { notify: (...args) => notify.push(args) }, sessionManager: entries };
  const run = (args) => env.extension.commands.get("codeblocks").handler(args, ctx);
  return { env, written, notify, run };
}

test("/codeblocks copy copies the numbered block from the top of the last reply", async () => {
  const { env, written, notify, run } = await commandEnv(entriesWith(
    "old\n\n```js\nconst a = 1;\n```",
    `${BOX}\n\n\`\`\`ts\nconst b = 2;\n\`\`\``,
  ));
  const box = "cd ~/Programming/project-palace &&\npython3 scripts/sync_mail.py --dry-run";
  if (!env.hasParser) {
    await run("copy");
    assert.match(notify.at(-1)[0], /needs Pi 0\.85\.1 or later/);
    env.slotOf().clipboard = undefined;
    return;
  }
  await run("copy");
  assert.deepEqual(written, [box]);
  assert.match(notify.at(-1)[0], /Copied code block 1 of 2/);
  await run("copy 2");
  assert.deepEqual(written.at(-1), "const b = 2;");
  await run("copy 3");
  assert.match(notify.at(-1)[0], /has 2 code block/);
  assert.equal(notify.at(-1)[1], "warning");
  await run("");
  assert.equal(written.at(-1), box, "no argument means the first block");
  env.slotOf().clipboard = undefined;
});

test("/codeblocks does not copy an older reply when the latest reply has no blocks", async () => {
  const { env, notify, run, written } = await commandEnv(entriesWith(JS, "no code here"));
  await run("copy");
  assert.deepEqual(written, []);
  assert.match(notify.at(-1)[0], env.hasParser ? /no code block in the last reply/ : /needs Pi 0\.85\.1 or later/);
  await run("paste");
  assert.match(notify.at(-1)[0], /Usage: \/codeblocks copy/);
});

test("the frame names the format the way a reader expects", async () => {
  const env = await setup({ env: COPY });
  const label = (lang) => stripVTControlCharacters(env.component(`\`\`\`${lang}\ncode\n\`\`\``).render(W)[0]).trimEnd();
  const cases = [
    ["js", "JavaScript"], ["javascript", "JavaScript"], ["ts", "TypeScript"], ["python", "Python"], ["py", "Python"],
    ["text", "Text"], ["plaintext", "Text"], ["node", "JavaScript"], ["yml", "YAML"], ["c++", "C++"], ["c#", "C#"],
    ["html", "HTML"], ["json", "JSON"], ["bash", "Bash"], ["zsh", "Zsh"], ["console", "Shell"], ["ps1", "PowerShell"],
    ["md", "Markdown"], ["rs", "Rust"], ["go", "Go"], ["vue", "Vue"],
  ];
  const suffix = env.hasMouse ? " \\[Copy\\] " : "";
  for (const [lang, name] of [...cases, ["made-up-lang", "made-up-lang"], ["MermaidLike", "MermaidLike"]]) {
    assert.match(label(lang), new RegExp(`^╭─ ${name.replace(/[+#]/g, "\\$&")} ─+${suffix}╮$`), lang);
  }
});

test("a long label and a Copy tag never overrun a narrow frame", async () => {
  const env = await setup({ env: COPY });
  for (const lang of ["typescript-react-native-component", "\uac00".repeat(12)]) {
    for (const width of [24, 30, 40]) {
      const component = env.component(`\`\`\`${lang}\ncode\n\`\`\``);
      const rows = component.render(width);
      assert.ok(rows.every((line) => env.visibleWidth(line) === width), `${lang} at ${width}`);
      assert.match(stripVTControlCharacters(rows[0]).trimEnd(), env.hasMouse ? /^╭─ .*─+ \[Copy\] ╮$/ : /^╭─ .*─+╮$/, `${lang} at ${width}`);
    }
  }
});

test("environment flags accept the usual spellings on and off", async () => {
  const label = async (env) => {
    const e = await setup({ env });
    return stripVTControlCharacters(e.component().render(W)[0]).trimEnd();
  };
  assert.match(await label({ PI_CODEBLOCKS_LANG: "false" }), /^╭─+╮$/);
  assert.match(await label({ PI_CODEBLOCKS_LANG: "off" }), /^╭─+╮$/);
  assert.match(await label({ PI_CODEBLOCKS_LANG: "0" }), /^╭─+╮$/);
  assert.match(await label({ PI_CODEBLOCKS_LANG: "yes" }), /^╭─ JavaScript ─+╮$/);
  assert.match(await label({ PI_CODEBLOCKS_LANG: "" }), /^╭─ JavaScript ─+╮$/, "blank keeps the default");

  const off = await setup({ env: { PI_CODEBLOCKS_COPY: "no" } });
  assert.ok(!off.component().render(W).some((line) => line.includes("[Copy]")));
  const on = await setup({ env: { PI_CODEBLOCKS_COPY: "TRUE" } });
  assert.equal(on.component().render(W).some((line) => line.includes("[Copy]")), on.hasMouse);
  const shaded = await setup({ env: { PI_CODEBLOCKS_FILL: "1" } });
  assert.ok(shaded.component().render(W).every((line) => line.includes("\x1b[48;")));
  const ascii = await setup({ env: { PI_CODEBLOCKS_ASCII: "on" } });
  assert.match(stripVTControlCharacters(ascii.component().render(W)[0]), /^\+- JavaScript -+\+$/);
});

test("CRLF replies and CRLF boxes survive a Windows-edited source", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasParser) return;
  const crlf = BOX.replaceAll("\n", "\r\n");
  assert.equal(env.render(crlf).replaceAll("\r\n", "\n"), env.render(BOX));
  const source = ["Run:", "", "╭──────────╮", "│ ls -la   │", "╰──────────╯", ""].join("\r\n");
  const shown = env.render(source);
  assert.match(shown, /```bash\nls -la\n```/);
  const component = env.component(shown);
  assert.ok(component.render(W).every((line) => env.visibleWidth(line) === W));
  assert.equal(regionsOf(component)[0].text, "ls -la");
});

test("ASCII mode draws a frame a legacy Windows console can print", async () => {
  const env = await setup({ env: { ...COPY, PI_CODEBLOCKS_ASCII: "1" } });
  for (const source of [`\`\`\`js\nconst a = 1;\n\`\`\``, "```a-very-long-language-name\ncode\n```"]) {
    for (const width of [24, 40]) {
      const rows = env.component(source).render(width).map((line) => stripVTControlCharacters(line));
      const text = rows.join("\n");
      assert.ok(/^[\x20-\x7e\n]*$/.test(text), `pure printable ASCII at ${width}: ${JSON.stringify(text.slice(0, 40))}`);
      assert.ok(rows.every((line) => env.visibleWidth(line) === width));
    }
  }
  assert.match(stripVTControlCharacters(env.component().render(W)[0]), env.hasMouse ? /^\+- JavaScript .* \[Copy\] \+$/ : /^\+- JavaScript -+\+$/);
});

test("only the right-hand Copy button is clickable even when the format label matches it", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  const written = [];
  env.slotOf().clipboard = async (text) => written.push(text);
  for (const lang of ["js", "\u65e5\u672c\u8a9e", "\uac00".repeat(9), "[Copy]", "[Copied!]"]) {
    const component = env.component(`\`\`\`${lang}\ncode\n\`\`\``);
    const top = stripVTControlCharacters(component.render(50)[0]);
    const [region] = regionsOf(component);
    const button = top.lastIndexOf("[Copy]");
    assert.equal(region.col, env.visibleWidth(top.slice(0, button)), lang);
    assert.equal(region.width, "[Copy]".length);
    if (lang.startsWith("[")) assert.equal(component.handleMouse(click(region, { x: top.indexOf(lang) })), undefined);
    assert.deepEqual(component.handleMouse(click(region)), { handled: true }, lang);
    await flush();
    assert.equal(written.at(-1), "code");
  }
  assert.equal(written.length, 5);
});

test("a block inside a quote is framed at its own offset and still copies", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  const written = [];
  env.slotOf().clipboard = async (text) => written.push(text);
  const component = env.component("> ```ts\n> const n = 1;\n> ```");
  component.render(W);
  const [region] = regionsOf(component);
  assert.ok(region, "quoted block has a region");
  assert.deepEqual(component.handleMouse(click(region)), { handled: true });
  assert.deepEqual(written, ["const n = 1;"]);
  env.slotOf().clipboard = undefined;
});

test("a failed /codeblocks copy reports the reason instead of throwing", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasParser) return;
  env.slotOf().clipboard = async () => { throw new Error("Clipboard unavailable"); };
  const notify = [];
  const ctx = { mode: "tui", ui: { notify: (...args) => notify.push(args) }, sessionManager: entriesWith("```js\nconst a = 1;\n```") };
  await env.extension.commands.get("codeblocks").handler("copy", ctx);
  assert.deepEqual(notify.at(-1), ["pi-codeblocks: copy failed: Clipboard unavailable", "error"]);
  env.slotOf().clipboard = undefined;
});

test("a stale clipboard completion after shutdown does not redraw the renderer", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  let resolveWrite;
  let redraws = 0;
  env.slotOf().clipboard = () => new Promise((resolve) => { resolveWrite = resolve; });
  env.screen.requestRender = () => { redraws++; };
  const component = env.component();
  component.render(W);
  assert.deepEqual(component.handleMouse(click(regionsOf(component)[0])), { handled: true });
  await env.emit("session_shutdown");
  resolveWrite();
  await flush();
  assert.equal(redraws, 0);
  assert.match(stripVTControlCharacters(component.render(W)[0]).trimEnd(), /^```js$/);
});

test("shutdown removes the clipboard widget it registered", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  assert.deepEqual(env.cleared, []);
  await env.emit("session_shutdown");
  assert.deepEqual(env.cleared, ["pi-codeblocks.copy"]);
});

test("a cached frame follows the live TUI mode and drops stale hit regions", async () => {
  const env = await setup({ env: COPY });
  if (!env.hasMouse) return;
  const component = env.component();
  assert.match(component.render(W)[0], /\[Copy\]/);
  const [region] = regionsOf(component);
  env.screen.mode = "regular";
  assert.equal(component.handleMouse(click(region)), undefined);
  assert.doesNotMatch(component.render(W)[0], /\[Copy\]/);
  assert.deepEqual(regionsOf(component), []);
  env.screen.mode = "fullscreen";
  assert.match(component.render(W)[0], /\[Copy\]/);
  assert.equal(regionsOf(component).length, 1);
});

test("keyboard copy follows the active branch and includes nested blocks in screen order", async () => {
  const { SessionManager } = await fromPi("core/session-manager.js");
  const session = SessionManager.inMemory(process.cwd());
  const reply = (...texts) => session.appendMessage({
    role: "assistant", content: texts.map((text) => ({ type: "text", text })), stopReason: "stop", timestamp: 1,
  });
  const parent = session.appendMessage({ role: "user", content: "Fixture", timestamp: 0 });
  const active = reply(JS, "> ```text\n> before\x07after\n> \tindented\n> ```");
  session.branch(parent);
  reply(TS);
  session.branch(active);
  const { env, written, run } = await commandEnv(session);
  if (!env.hasParser) return;
  await run("copy");
  await run("copy 2");
  assert.deepEqual(written, [JS_LINE, "beforeafter\n   indented"]);
});

test("keyboard and mouse copy agree on partial fences without stripping literal backticks", async () => {
  for (const [source, expected] of [
    ['```sh\nprintf ok\n``', "printf ok"],
    ['> ~~~sh\n> printf ok\n> ~~', "printf ok"],
    ['- Example\n\n  ```sh\n  printf ok\n  ``', "printf ok"],
    ['````text\nbody\n```\n````', "body\n```"],
    ['```text\nbefore\x1b[38:2::12:34:56mmessage\n```', "beforemessage"],
  ]) {
    const { env, run, written } = await commandEnv(entriesWith(source));
    if (!env.hasParser) return;
    await run("copy");
    assert.deepEqual(written, [expected], source);
    if (!env.hasMouse) continue;
    const component = env.component(source);
    component.render(W);
    assert.equal(regionsOf(component)[0]?.text, expected, source);
  }
});

test("keyboard copy uses Pi's block order when a reply contains display math and repeated code", async () => {
  const math = "$$\n\\text{example}\n```text\nmath fixture\n```\n$$";
  const source = [TS, JS, JS, math].join("\n\n");
  const { env, run, written } = await commandEnv(entriesWith(source));
  if (!env.hasMouse || !env.hasParser) return;
  const component = env.component(source);
  component.render(W);
  const visible = regionsOf(component).map((region) => region.text);
  assert.equal(visible.filter((body) => body === JS_LINE).length, 2);
  for (let i = 1; i <= visible.length; i++) await run(`copy ${i}`);
  assert.deepEqual(written, visible);
});

test("empty, whitespace-only and control-only blocks cannot overwrite the clipboard", async () => {
  const empty = ["```text\n```", "```text\n   \n```", "```text\n\x1b[31m\x1b[0m\n```"].join("\n\n");
  const { env, run, written } = await commandEnv(entriesWith(`${JS}\n\n${empty}`));
  if (!env.hasParser) return;
  await run("copy");
  await run("copy 2");
  assert.deepEqual(written, [JS_LINE]);
  if (env.hasMouse) {
    const component = env.component(empty);
    const lines = component.render(W);
    assert.ok(lines.some((line) => line.includes("╭")));
    assert.deepEqual(regionsOf(component), []);
  }
  const onlyEmpty = await commandEnv(entriesWith(empty));
  await onlyEmpty.run("copy");
  assert.deepEqual(onlyEmpty.written, []);
  assert.match(onlyEmpty.notify.at(-1)[0], /no code block in the last reply/);
});

test("overlapping mouse and keyboard copies write in order, even after a rejected write", async () => {
  for (const failure of [false, true]) {
    const { env, run } = await commandEnv(entriesWith(TS));
    if (!env.hasMouse || !env.hasParser) return;
    const started = [];
    const written = [];
    let finishFirst;
    env.slotOf().clipboard = (text) => {
      started.push(text);
      if (text === JS_LINE) {
        return new Promise((resolve, reject) => {
          finishFirst = () => {
            if (failure) reject(new Error("clipboard unavailable"));
            else { written.push(text); resolve(); }
          };
        });
      }
      written.push(text);
      return Promise.resolve();
    };
    const component = env.component(JS);
    component.render(W);
    assert.deepEqual(component.handleMouse(click(regionsOf(component)[0])), { handled: true });
    const latest = run("copy");
    assert.deepEqual(started, [JS_LINE]);
    finishFirst();
    await latest;
    const second = "const n: number = 1;";
    assert.deepEqual(started, [JS_LINE, second]);
    assert.deepEqual(written, failure ? [second] : [JS_LINE, second]);
  }
});

test("noninteractive sessions and invalid block numbers never call the clipboard", async () => {
  for (const mode of ["rpc", "json", "print"]) {
    const { run, written, notify } = await commandEnv(entriesWith(JS), mode);
    await run("copy");
    assert.deepEqual(written, []);
    assert.match(notify.at(-1)[0], /needs the interactive TUI/);
  }
  const { run, written, notify } = await commandEnv(entriesWith(JS));
  for (const args of ["copy nope", "copy 0", "copy -2", "copy 2.5", "copy 0x1", "copy 9007199254740993", "copy 1 extra"]) {
    await run(args);
    assert.deepEqual(written, [], args);
    assert.match(notify.at(-1)[0], /positive integer/, args);
  }
});
