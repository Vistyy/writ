# Instruction lint

Local Markdown linting for the agent instructions owned by this repository.

The configured scope includes `AGENTS.md`, optional Pi system-prompt files, skills and their references, and user skills.

`markdownlint` provides the parser and rules. `markdownlint-cli2` is the command-line runner that discovers files, loads the configuration, formats diagnostics, and sets the exit status. Both resolve to one installed copy of `markdownlint`; they are not old and new versions of the same package.

Only these checks are enabled:

| Rule | Rejected input |
| --- | --- |
| [`MD001`](https://github.com/DavidAnson/markdownlint/blob/main/doc/md001.md) | A heading that skips to a deeper level |
| [`MD011`](https://github.com/DavidAnson/markdownlint/blob/main/doc/md011.md) | Reversed link syntax such as `(text)[target]` |
| [`MD018`](https://github.com/DavidAnson/markdownlint/blob/main/doc/md018.md) | An ATX heading without a space after `#` |
| [`MD042`](https://github.com/DavidAnson/markdownlint/blob/main/doc/md042.md) | A link with no destination |
| [`MD051`](https://github.com/DavidAnson/markdownlint/blob/main/doc/md051.md) | A same-file fragment that has no matching anchor |
| [`MD052`](https://github.com/DavidAnson/markdownlint/blob/main/doc/md052.md) | A reference link or image with no definition |
| `local-links-exist` | A concrete relative file or image destination that does not exist |

The local rule checks the file portion of cross-file fragment links, but not external URLs or whether the cross-file fragment exists. Two links in `skills/domain-modeling/references/GLOSSARY-FORMAT.md` are excluded by exact source and destination because they intentionally demonstrate fictional bounded contexts; the rest of that file is still checked.

`default: false` disables markdownlint's normal behavior of enabling every built-in rule. The configuration then opts into only the checks above, avoiding unrelated formatting and house-style rules.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm check
```
