# Changelog

## [0.1.1] - 2026-11-18

### Fixed

- The npm package page and the Pi gallery show the English README. Translated guides use `README-<locale>.md` names, so npm no longer picks one of them as the package readme.

## [0.1.0] - 2026-11-17

### New Features

- Framed code blocks with the format on the top rule, drawn with Pi's own syntax highlighting and theme colours.
- Readable format names: `js` is JavaScript, `ts` is TypeScript, `py` is Python, `text` is Text. An unknown label is shown as written.
- A `[Copy]` button on finished, non-empty blocks in fullscreen mode copies the body without fences, frame padding, or terminal controls. The clicked button shows `[Copied!]` after the write succeeds.
- Recognized shell-command boxes are rendered as fenced code blocks without changing stored messages.
- `/codeblocks copy [n]` counts non-empty code blocks from the top of the latest assistant reply on the active branch. It is available in regular and fullscreen TUI modes.
- Language aliases (`fish`, `node`, `jsonc`, `pwsh`, and others) borrow the closest grammar Pi has.
- One-line backtick fences in finished replies are repaired into real blocks.
- Environment flags: `PI_CODEBLOCKS_LANG`, `PI_CODEBLOCKS_FILL`, `PI_CODEBLOCKS_ASCII`, `PI_CODEBLOCKS_BAR`, `PI_CODEBLOCKS_COPY`.

### Changed

- Reload replaces the renderer handlers instead of wrapping them again, and a later wrapper from another extension is left in place.
- A missing Markdown renderer warns once in the TUI instead of failing silently.
- The clipboard-capture widget is removed when the session shuts down.

### Fixed

- Copy hit regions survive a cached re-render between press and release.
- A long format label next to the copy tag no longer overruns a narrow frame.
- Keyboard copy follows the active session branch and includes blocks inside quotes and lists.
- Copy buttons follow the actual TUI mode and no longer appear on unfinished streamed blocks or hosts without mouse routing.
- Copy feedback is tied to the clicked block; a matching format label cannot move the hit target.
- One-line repair preserves embedded backticks and executable names in command invocations. Repairs leave display math, multiline inline code, and ambiguous command boxes alone.
- Keyboard copy uses Pi's code-block parsing, including its handling of partial fences and math. Empty blocks cannot clear the clipboard.
- Clipboard writes stay in request order. The copy command rejects invalid indices and never writes to the clipboard in noninteractive modes.
- A clipboard backend that never answers fails with an error instead of blocking every later copy.
- Copy feedback stays on its block until the timeout, even when the transcript re-renders.
- Terminal-sequence cleanup preserves the printable text around escape sequences.

### Documentation

- Updated the English, Korean, Japanese, and Simplified Chinese guides to match the copy behavior. Added French, Spanish, and Brazilian Portuguese guides, with links between all seven languages.
