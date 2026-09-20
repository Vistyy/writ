# Instruction lint

Local Markdown linting for the agent instructions owned by this repository.

The configured scope includes `AGENTS.md`, optional Pi system-prompt files, skills and their references, and user skills.

`markdownlint` provides the parser and rules. `markdownlint-cli2` is the command-line runner that discovers files, loads the configuration, formats diagnostics, and sets the exit status. Both resolve to one installed copy of `markdownlint`; they are not old and new versions of the same package.

The enabled rules and their purposes are documented inline in `.markdownlint-cli2.mjs`. The complete built-in catalog is in the [markdownlint rule documentation](https://github.com/DavidAnson/markdownlint/blob/main/doc/Rules.md).

The local rule checks the file portion of cross-file fragment links, but not external URLs or whether the cross-file fragment exists. Two links in `skills/domain-modeling/references/GLOSSARY-FORMAT.md` are excluded by exact source and destination because they intentionally demonstrate fictional bounded contexts; the rest of that file is still checked.

`default: false` disables markdownlint's normal behavior of enabling every built-in rule. The configuration then opts into only the checks above, avoiding unrelated formatting and house-style rules.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm check
```
