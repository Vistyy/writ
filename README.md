# Instruction lint

Local Markdown linting for the agent instructions owned by this repository.

The configured scope includes `AGENTS.md`, optional Pi system-prompt files, skills and their references, and user skills.

`markdownlint-cli2` supplies the command-line runner and the underlying `markdownlint` parser and built-in rules. `markdownlint-rule-relative-links` adds filesystem and cross-file-fragment validation.

The enabled rules and their purposes are documented inline in `.markdownlint-cli2.mjs`. The complete built-in catalog is in the [markdownlint rule documentation](https://github.com/DavidAnson/markdownlint/blob/main/doc/Rules.md).

Relative Markdown links and images must resolve to local files, and fragments targeting Markdown files must resolve to headings or anchors. External links and links inside fenced examples are not checked.

`default: false` disables markdownlint's normal behavior of enabling every built-in rule. The configuration then opts into only the checks above, avoiding unrelated formatting and house-style rules.

```sh
pnpm install --frozen-lockfile
pnpm check
```
