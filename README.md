# Instruction lint

Checks for the Markdown instructions owned by this repository.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test
TYPESAFE_API_KEY=... pnpm check:semantic
TYPESAFE_API_KEY=... pnpm check:references
TYPESAFE_API_KEY=... pnpm check:questions
```

- `pnpm check` is the deterministic Markdown check. It makes no model requests.
- `pnpm check:semantic` is the paid routing-semantic check for skill frontmatter.
- `pnpm check:references` is the separate paid reference-semantic check.
- `pnpm check:questions` is the separate paid calibration and question-contract check for both semantic suites.
- `pnpm test` uses fake clients and makes no network requests.

## Deterministic Markdown check

`markdownlint-cli2` provides the runner, parser, and enabled built-in rules. `markdownlint-rule-relative-links` validates local files and Markdown fragments. The exact rules and scope are documented in `.markdownlint-cli2.mjs`; unrelated formatting and house-style rules remain disabled.

## Routing semantic check

`check:semantic` finds nested `SKILL.md` files only below top-level `skills/` and `user-skills/`. Either root may be absent. It skips frontmatter with `disable-model-invocation: true` and sends only `name` and `description` to exact model `jev-1.13.0`; bodies, paths, other frontmatter, and repository context are not sent.

Five independent Noul judgments cover capability and activation presence/specificity plus routing focus. Findings and unknowns are advisory and exit successfully. Invalid metadata, provider failures, invalid responses or token usage, and model mismatch are fatal. The receipt reports model, token, evaluated, and skipped counts.

## Reference semantic check

`check:references` scans exactly these instruction-lint-owned Markdown locations when present:

- root `AGENTS.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md`
- every `skills/**/*.md`
- every `user-skills/**/*.md`

It uses `markdown-it` parsed tokens and source maps to find relative local Markdown links and backticked relative `.md` paths. Fenced and indented code, frontmatter, external URLs, absolute URLs/paths, hash-only links, invalid targets, and non-path code such as literal `.md` are excluded. Targets resolve relative to the source file; fragments are retained for the semantic occurrence but stripped for filesystem existence checks. Diagnostics identify the local source path and line.

All files and targets are checked deterministically before requests. A missing Markdown link is fatal and prevents every paid request. A missing backticked path is semantically judged for whether the instruction expects it to exist. Existing links and backticks receive the consultation and scoped-trigger judgments together. Independent questions for one source file are batched into one `systemOne` request using exact model `jev-1.13.0`.

The privacy boundary is strict: shared request state is the empty string, local source paths and repository context are not sent, and referenced targets are checked with filesystem metadata rather than opened for an occurrence. No referenced target content is read or sent. Each generated question contains only its occurrence's heading, instruction span, exact link text/target, and relative path as applicable.

Composition order is fixed:

1. A missing backtick expected to exist produces a stale-reference advisory; intentional creation, generation, output, destination, rename-to, optional-if-present, and example uses are clean; unknown is advisory.
2. For an existing target, a consultation finding suppresses the trigger result. A consultation unknown is advisory and gives no trigger conclusion.
3. Only a consultation pass consumes the trigger result. A trigger finding advises stating when consultation is required; trigger unknown is advisory; trigger pass is clean.

Semantic findings and unknowns are advisory and exit successfully. Parse, provider, exact-model, integer-token, answer-shape, probability, and deterministic missing-link failures exit nonzero. The exact receipt reports scanned file and occurrence counts, paid request count, and aggregate input/output tokens.

## Question calibration

`check:questions` first validates routing and reference contracts and their dependencies deterministically. It then runs each suite's actual generated runtime questions against its concrete calibration corpus. Reference cases protect ownership/direct-modification non-consultation; explicit before/when, compound, and heading-scoped triggers; bare and vague triggers; expected-existing ownership/read/update/move-from; and intentional create/generate/output/rename-to/if-present/example paths.

Calibration mismatches and unknowns are fatal. Meta findings and unknowns are advisory. The reference suite retains only model-judgment necessity, one-semantic-axis, its three pairwise-distinctness checks, and consultation-to-trigger dependency validity. Routing/reference pairs are never compared. The command verifies exact model identity, nonnegative integer token usage, exact Noul answer shape, and probability bounds, then prints an aggregate receipt.
