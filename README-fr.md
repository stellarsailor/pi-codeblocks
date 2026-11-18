# pi-codeblocks

Des blocs de code Markdown encadrés, avec nom de langage, coloration syntaxique et bouton de copie pour l'interface en terminal de l'agent de programmation [Pi](https://pi.dev).

[English](README.md) · [한국어](README-ko.md) · [日本語](README-ja.md) · [简体中文](README-zh-CN.md) · **Français** · [Español](README-es.md) · [Português (Brasil)](README-pt-BR.md)

![Aperçu d’un bloc TypeScript encadré avec coloration syntaxique et bouton de copie dans Pi](assets/code-block-preview.png)

Nécessite Node.js 22.19.0 ou ultérieur et Pi 0.79.9 ou ultérieur. La copie et la correction du Markdown ont été testées à partir de Pi 0.85.1. Pi 0.79.9 et 0.80.3 affichent uniquement les cadres.

## Installation

```bash
pi install /path/to/pi-codeblocks  # depuis un dépôt local
pi install npm:pi-codeblocks       # après publication sur npm
```

Redémarrez Pi ou lancez `/reload`. Pour essayer l'extension sans l'installer, lancez `pi -e /path/to/pi-codeblocks/extensions/code-blocks.ts`. Pour la désinstaller, passez la même source à `pi remove`.

## Copier du code

- **Souris :** en plein écran, `[Copy]` apparaît sur les blocs terminés et non vides qui disposent d'au moins 24 colonnes. Une fois la copie effectuée, seul le bouton cliqué affiche `[Copied!]` pendant 1,5 seconde. Faites glisser la souris pour sélectionner le texte affiché.
- **Clavier :** `/codeblocks copy` copie le premier bloc de code non vide de la réponse la plus récente de l'assistant sur la branche active, y compris dans les citations et les listes. Les blocs sont numérotés depuis le haut de la réponse, donc `/codeblocks copy 2` copie le deuxième. Un numéro invalide ou hors limites, ou une réponse sans code, ne modifie pas le presse-papiers. La commande fonctionne dans l'interface interactive, en mode normal ou plein écran, mais pas en mode RPC, JSON ou impression.
- **Texte copié :** les retours à la ligne et l'indentation sont conservés. Les tabulations deviennent les trois espaces affichés par Pi. Les délimiteurs du bloc, le remplissage du cadre et les caractères de contrôle du terminal sont exclus. Les deux méthodes utilisent l'analyse des blocs et le presse-papiers de Pi ; les écritures suivent l'ordre des demandes.

## Correction du Markdown

Dans les réponses terminées de l'assistant, l'extension corrige les blocs délimités sur une seule ligne et transforme les cadres textuels reconnus comme commandes du shell en blocs de code. Seul l'affichage change. Les apostrophes inversées et les noms des exécutables dans `python -m pytest` et `go test ./...` sont conservés. Les réponses contenant des formules en bloc, les cadres inclus dans du code en ligne sur plusieurs lignes et les cadres dont l'espacement après une barre oblique inverse est ambigu restent intacts. L'extension n'exécute pas de code et ne modifie pas les messages enregistrés.

## Options

Définissez les variables d'environnement avant de démarrer Pi. Une variable absente ou vide conserve la valeur par défaut. `0`, `false`, `no` et `off` désactivent une option sans tenir compte de la casse ; toute autre valeur non vide l'active.

| Variable | Par défaut | Si activée |
|---|---|---|
| `PI_CODEBLOCKS_LANG` | oui | Affiche le nom du format, par exemple JavaScript, TypeScript ou Text |
| `PI_CODEBLOCKS_COPY` | oui | Active le bouton de copie à la souris, indépendamment de la copie au clavier |
| `PI_CODEBLOCKS_FILL` | non | Utilise le fond neutre des outils du thème Pi |
| `PI_CODEBLOCKS_ASCII` | non | Dessine les cadres avec `+`, `-` et `\|`, et tronque avec `...` |
| `PI_CODEBLOCKS_BAR` | non | Garde seulement le bord supérieur et utilise toute la largeur pour le code |

## Compatibilité

Les blocs reprennent la coloration syntaxique et les couleurs de Pi et passent à la ligne selon la largeur disponible. Les blocs Mermaid et ceux de moins de 12 colonnes conservent l'affichage de Pi. Les cadres utilisent la méthode privée `Markdown.prototype.renderToken` ; si elle n'est pas disponible, Pi affiche les blocs normalement. N'activez qu'une extension de rendu des blocs de code à la fois.

Tests locaux sous macOS ARM64 avec Node.js 26 et Pi 0.79.9, 0.80.3, 0.85.1, 1.3.0, 1.4.0 et 1.5.0–1.5.2. Le [workflow de compatibilité](https://github.com/stellarsailor/pi-codeblocks/actions/workflows/compatibility.yml) cible macOS, Linux et Windows. Il ne vérifie ni les clics physiques ni le presse-papiers du bureau.

## Développement

```bash
npm install       # installe TypeScript et les types Node
npm test          # utilise une installation locale ou globale de Pi
npm run typecheck # requiert Pi installé localement pour ses types
```

MIT · [Historique des changements](CHANGELOG.md)
