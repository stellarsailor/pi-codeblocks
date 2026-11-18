# pi-codeblocks

[Pi](https://pi.dev) コーディングエージェントの TUI に、言語名、シンタックスハイライト、コピーボタンの付いた Markdown コードブロックを追加します。

[English](README.md) · [한국어](README-ko.md) · **日本語** · [简体中文](README-zh-CN.md) · [Français](README-fr.md) · [Español](README-es.md) · [Português (Brasil)](README-pt-BR.md)

![Pi の枠付き TypeScript コードブロック、シンタックスハイライト、コピーボタンのプレビュー](assets/code-block-preview.png)

Node.js 22.19.0 以降と Pi 0.79.9 以降が必要です。コピーと Markdown の修復は Pi 0.85.1 から検証済みです。Pi 0.79.9 と 0.80.3 では枠の表示のみ対応します。

## インストール

```bash
pi install /path/to/pi-codeblocks  # ローカルのチェックアウト
pi install npm:pi-codeblocks       # npm 公開後
```

Pi を再起動するか `/reload` を実行してください。インストールせずに試すには `pi -e /path/to/pi-codeblocks/extensions/code-blocks.ts` を使います。削除するときは `pi remove` にインストール時と同じソースを指定します。

## コードをコピー

- **マウス:** フルスクリーンで、生成が完了した空でないブロックに 24 列以上の幅があれば `[Copy]` が表示されます。コピーが成功すると、押したボタンだけが 1.5 秒間 `[Copied!]` に変わります。ドラッグは画面上のテキストを選択します。
- **キーボード:** `/codeblocks copy` はアクティブな分岐の最新のアシスタント応答から、引用やリスト内も含めて最初の空でないコードブロックをコピーします。番号は応答の先頭から振るため、`/codeblocks copy 2` は 2 番目のブロックです。番号が無効か範囲外の場合や、応答にコードがない場合、クリップボードは変更しません。通常とフルスクリーンの TUI で利用でき、RPC、JSON、出力モードでは使えません。
- **コピー内容:** 改行とインデントを保ちます。タブは Pi が表示する 3 つの空白になり、フェンスや枠の余白、端末制御文字は含みません。どちらの方法も Pi のコードブロック判定とクリップボード処理を使い、書き込みは要求順に行います。

## Markdown の修復

生成が完了したアシスタント応答の 1 行フェンスや、認識できるシェルコマンドの枠を、表示用のコードブロックに修復します。内部のバッククォートや `python -m pytest`、`go test ./...` の実行ファイル名は残ります。別行立ての数式を含む応答、複数行のインラインコード内の枠、バックスラッシュ後の空白があいまいな枠は変更しません。コードの実行や保存済みメッセージの変更は行いません。

## オプション

Pi の起動前に環境変数を設定します。未設定または空なら既定値です。大文字と小文字を区別せず `0`、`false`、`no`、`off` で無効になり、それ以外の空でない値で有効になります。

| 変数 | 既定値 | 有効時 |
|---|---|---|
| `PI_CODEBLOCKS_LANG` | 有効 | JavaScript、TypeScript、Text などの形式名を表示 |
| `PI_CODEBLOCKS_COPY` | 有効 | マウス用コピーボタンを表示。キーボードコピーには影響しない |
| `PI_CODEBLOCKS_FILL` | 無効 | Pi テーマのツール用背景色で塗る |
| `PI_CODEBLOCKS_ASCII` | 無効 | 枠に `+`、`-`、`\|` を使い、省略は `...` で表示 |
| `PI_CODEBLOCKS_BAR` | 無効 | 上罫線だけ残し、コードには全幅を使う |

## 互換性

Pi のシンタックスハイライトとテーマ色を使い、ブロックの幅に合わせて折り返します。Mermaid と幅が 12 列未満のブロックは Pi の標準表示のままです。枠は Pi の非公開メソッド `Markdown.prototype.renderToken` を使用し、利用できない場合は標準表示に戻ります。コードブロックのレンダリング拡張は一度に 1 つだけ有効にしてください。

macOS ARM64、Node.js 26 で、Pi 0.79.9、0.80.3、0.85.1、1.3.0、1.4.0、1.5.0–1.5.2 をローカルで検証しました。[互換性ワークフロー](https://github.com/stellarsailor/pi-codeblocks/actions/workflows/compatibility.yml) の対象は macOS、Linux、Windows です。実際のマウス入力やデスクトップのクリップボードは検証対象外です。

## 開発

```bash
npm install       # TypeScript と Node の型をインストール
npm test          # ローカルまたはグローバルの Pi を再利用
npm run typecheck # Pi の型のためローカルに Pi が必要
```

MIT · [変更履歴](CHANGELOG.md)
