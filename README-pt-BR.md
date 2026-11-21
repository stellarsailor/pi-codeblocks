# pi-codeblocks

Blocos de código Markdown com moldura, nome da linguagem, realce de sintaxe e botão de cópia para a interface de terminal do agente de programação [Pi](https://pi.dev).

[English](README.md) · [한국어](README-ko.md) · [日本語](README-ja.md) · [简体中文](README-zh-CN.md) · [Français](README-fr.md) · [Español](README-es.md) · **Português (Brasil)**

![Prévia de um bloco TypeScript com moldura, realce de sintaxe e botão de cópia no Pi](assets/code-block-preview.png)

Requer Node.js 22.19.0 ou superior e Pi 0.79.9 ou superior. A cópia e a correção de Markdown foram testadas a partir do Pi 0.85.1. O Pi 0.79.9 e o 0.80.3 só exibem as molduras.

## Instalação

```bash
pi install /path/to/pi-codeblocks  # a partir de um repositório local
pi install npm:pi-codeblocks       # após a publicação no npm
```

Reinicie o Pi ou execute `/reload`. Para testar sem instalar, execute `pi -e /path/to/pi-codeblocks/extensions/pi-codeblocks.ts`. Para desinstalar, informe ao `pi remove` a mesma origem usada na instalação.

## Copiar código

- **Mouse:** em tela cheia, `[Copy]` aparece nos blocos não vazios que já terminaram de ser gerados e têm pelo menos 24 colunas disponíveis. Após a cópia, só o botão clicado exibe `[Copied!]` por 1,5 segundo. Arrastar continua selecionando o texto na tela.
- **Teclado:** `/codeblocks copy` copia o primeiro bloco de código não vazio da resposta mais recente do assistente na branch ativa, incluindo blocos em citações e listas. Os blocos são numerados a partir do topo da resposta, então `/codeblocks copy 2` copia o segundo. Um número inválido ou fora do intervalo, ou uma resposta sem código, não altera a área de transferência. Funciona na TUI em modo normal ou em tela cheia, mas não em RPC, JSON ou modo de impressão.
- **Texto copiado:** mantém as quebras de linha e a indentação. As tabulações viram os três espaços exibidos pelo Pi. Os delimitadores do bloco, o preenchimento da moldura e os caracteres de controle do terminal ficam de fora. Os dois métodos usam a análise de blocos e a área de transferência do Pi, com gravações na ordem das solicitações.

## Correções de Markdown

Nas respostas concluídas do assistente, a extensão corrige delimitadores em uma única linha e converte caixas de texto identificadas como comandos de shell em blocos de código. Só a exibição muda. Os acentos graves dentro do código e os nomes dos executáveis em comandos como `python -m pytest` e `go test ./...` são mantidos. Respostas com fórmulas em bloco, caixas dentro de código inline que ocupa várias linhas e caixas com espaços ambíguos depois de uma barra invertida ficam como estão. A extensão não executa código nem altera mensagens salvas.

## Opções

Defina as variáveis de ambiente antes de iniciar o Pi. Variáveis ausentes ou vazias mantêm o padrão. `0`, `false`, `no` e `off` desativam a opção, sem distinção entre maiúsculas e minúsculas. Qualquer outro valor não vazio a ativa.

| Variável | Padrão | Quando ativada |
|---|---|---|
| `PI_CODEBLOCKS_LANG` | ligada | Mostra o nome do formato, como JavaScript, TypeScript ou Text |
| `PI_CODEBLOCKS_COPY` | ligada | Ativa o botão de cópia com o mouse, sem afetar a cópia pelo teclado |
| `PI_CODEBLOCKS_FILL` | desligada | Usa a cor de fundo neutra das ferramentas no tema do Pi |
| `PI_CODEBLOCKS_ASCII` | desligada | Usa bordas `+`, `-` e `\|`, com `...` para truncar |
| `PI_CODEBLOCKS_BAR` | desligada | Mantém só a borda superior e usa toda a largura para o código |

## Compatibilidade

Os blocos usam o realce de sintaxe e as cores do Pi, com quebras de linha na largura disponível. Mermaid e blocos com menos de 12 colunas mantêm a exibição padrão do Pi. A moldura depende do método privado `Markdown.prototype.renderToken`; se ele não estiver disponível, o Pi exibe o código normalmente. Use apenas uma extensão de renderização de blocos de código por vez.

Testes locais no macOS ARM64 com Node.js 26 e Pi 0.79.9, 0.80.3, 0.85.1, 1.3.0, 1.4.0 e 1.5.0–1.5.2. O [workflow de compatibilidade](https://github.com/stellarsailor/pi-codeblocks/actions/workflows/compatibility.yml) abrange macOS, Linux e Windows. Ele não testa cliques físicos nem a área de transferência do ambiente gráfico.

## Desenvolvimento

```bash
npm install       # instala TypeScript e os tipos do Node
npm test          # usa uma instalação local ou global do Pi
npm run typecheck # precisa do Pi instalado localmente para os tipos
```

MIT · [Histórico de alterações](CHANGELOG.md)
