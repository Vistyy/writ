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
pnpm test
```

`pnpm check` is the deterministic Markdown check. It makes no model requests and does not require `TYPESAFE_API_KEY`.

## Advisory semantic check

```sh
TYPESAFE_API_KEY=... pnpm check:semantic
```

`check:semantic` is a separate paid, networked check. It finds nested `SKILL.md` files only under the repository's top-level `skills/` and `user-skills/` instruction roots, skips skills whose YAML frontmatter sets `disable-model-invocation: true`, and evaluates implicit-routing metadata with the exact pinned model `jev-1.13.0`. Either instruction root may be absent. Each applicable skill causes one request containing only its frontmatter `name` and `description`; skill bodies, paths, other frontmatter, and repository context are not sent.

The four independent judgments check whether capability and activation guidance are each present and specific. Findings and uncertain results are printed with raw probabilities as advisory diagnostics and exit successfully. Invalid applicable metadata, missing credentials, provider failures, and a returned model identity other than exactly `jev-1.13.0` exit nonzero. The final receipt reports the returned model identity, aggregate input/output tokens, and evaluated/skipped counts.

`pnpm test` uses a fake client and makes no paid or live requests.
