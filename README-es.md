# pi-codeblocks

Bloques de código Markdown con marco, nombre del lenguaje, resaltado de sintaxis y botón para copiar en la interfaz de terminal del agente de programación [Pi](https://pi.dev).

[English](README.md) · [한국어](README-ko.md) · [日本語](README-ja.md) · [简体中文](README-zh-CN.md) · [Français](README-fr.md) · **Español** · [Português (Brasil)](README-pt-BR.md)

![Vista previa de un bloque TypeScript con marco, resaltado y botón para copiar en Pi](assets/code-block-preview.png)

Requiere Node.js 22.19.0 o posterior y Pi 0.79.9 o posterior. La copia y la corrección de Markdown se han probado a partir de Pi 0.85.1. Pi 0.79.9 y 0.80.3 solo dibujan los marcos.

## Instalación

```bash
pi install /path/to/pi-codeblocks  # desde un repositorio local
pi install npm:pi-codeblocks       # tras la publicación en npm
```

Reinicia Pi o ejecuta `/reload`. Para probar la extensión sin instalarla, ejecuta `pi -e /path/to/pi-codeblocks/extensions/pi-codeblocks.ts`. Para desinstalarla, indica a `pi remove` la misma fuente que usaste para instalarla.

## Copiar código

- **Ratón:** en pantalla completa, `[Copy]` aparece en los bloques no vacíos que ya se han generado y disponen de al menos 24 columnas. Tras copiar, solo el botón pulsado muestra `[Copied!]` durante 1,5 segundos. Arrastrar sigue seleccionando el texto en pantalla.
- **Teclado:** `/codeblocks copy` copia el primer bloque de código no vacío de la respuesta más reciente del asistente en la rama activa, incluso dentro de citas y listas. Los bloques se numeran desde arriba de la respuesta, así que `/codeblocks copy 2` copia el segundo. Un número no válido o fuera de rango, o una respuesta sin código, no modifica el portapapeles. Funciona en la TUI en modo normal o de pantalla completa, no en RPC, JSON ni en modo de impresión.
- **Texto copiado:** conserva los saltos de línea y la sangría; las tabulaciones se convierten en los tres espacios que muestra Pi. Se excluyen los delimitadores del bloque, el relleno del marco y los caracteres de control del terminal. Ambos métodos usan el reconocimiento de bloques y el portapapeles de Pi; las escrituras siguen el orden de las solicitudes.

## Corrección de Markdown

En las respuestas terminadas del asistente, la extensión corrige los delimitadores de una sola línea y convierte los recuadros de texto reconocidos como comandos de shell en bloques de código. Solo cambia la visualización. Conserva las comillas invertidas internas y los nombres de los ejecutables en comandos como `python -m pytest` y `go test ./...`. Deja intactas las respuestas con fórmulas en bloque, los recuadros dentro de código en línea que abarca varias líneas y los recuadros con espacios ambiguos después de una barra invertida. No ejecuta código ni modifica los mensajes guardados.

## Opciones

Define las variables de entorno antes de iniciar Pi. Si una variable no está definida o está vacía, conserva el valor predeterminado. `0`, `false`, `no` y `off` la desactivan, sin distinguir mayúsculas; cualquier otro valor no vacío la activa.

| Variable | Predeterminado | Al activarla |
|---|---|---|
| `PI_CODEBLOCKS_LANG` | sí | Muestra el nombre del formato, como JavaScript, TypeScript o Text |
| `PI_CODEBLOCKS_COPY` | sí | Activa el botón de copia con el ratón sin afectar la copia con el teclado |
| `PI_CODEBLOCKS_FILL` | no | Usa el fondo neutro para herramientas del tema de Pi |
| `PI_CODEBLOCKS_ASCII` | no | Dibuja los bordes con `+`, `-` y `\|`, y usa `...` al truncar |
| `PI_CODEBLOCKS_BAR` | no | Conserva solo el borde superior y deja todo el ancho para el código |

## Compatibilidad

Los bloques usan el resaltado de sintaxis y los colores de Pi, y ajustan las líneas al ancho disponible. Mermaid y los bloques de menos de 12 columnas conservan la visualización normal de Pi. El marco usa el método privado `Markdown.prototype.renderToken`; si no está disponible, Pi muestra el código como siempre. Activa una sola extensión de renderizado de bloques de código a la vez.

Pruebas locales en macOS ARM64 con Node.js 26 y Pi 0.79.9, 0.80.3, 0.85.1, 1.3.0, 1.4.0 y 1.5.0–1.5.2. El [flujo de compatibilidad](https://github.com/stellarsailor/pi-codeblocks/actions/workflows/compatibility.yml) abarca macOS, Linux y Windows. No comprueba los clics físicos ni el portapapeles del escritorio.

## Desarrollo

```bash
npm install       # instala TypeScript y los tipos de Node
npm test          # utiliza una instalación local o global de Pi
npm run typecheck # requiere Pi instalado localmente para sus tipos
```

MIT · [Historial de cambios](CHANGELOG.md)
