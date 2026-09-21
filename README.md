# Writ

Agents act on instruction files, so small defects in routing metadata, references, or Markdown can change what they do. Writ makes those defects observable: it runs a fixed offline Markdown check and optional TypeSafe-powered semantic checks with explicit privacy boundaries, deterministic failure rules, and usage receipts.

## Install

```sh
pnpm add --save-dev @syzom/writ
```

Writ requires Node.js 22 or newer. Run it through your package manager or install it globally to use the `writ` executable.

## Commands

```sh
writ check [--root <path>]
writ routing [--root <path>]
writ references [--root <path>]
writ questions
writ --help
writ --version
```

For `check`, `routing`, and `references`, `--root` defaults to the caller's current directory. Relative roots are resolved from that directory. `questions` is a package-level calibration command and does not accept a repository root. Invalid commands or arguments exit with status 2 before any model client is created.

### `writ check`

This deterministic, offline command runs markdownlint-cli2 programmatically with Writ-owned configuration. Consumer markdownlint configuration and in-document enable/disable directives are ignored, so neither can change the fixed rule set. It scans exactly these locations when present:

- root `AGENTS.md`, `SYSTEM.md`, and `APPEND_SYSTEM.md`
- `skills/**/*.md`
- `user-skills/**/*.md`

The fixed rules check selected Markdown structure, frontmatter handling, links, fragments, and relative targets. Ordinary lint findings exit with status 1; a clean scope exits 0. Writ does not add a consumer configuration framework.

### `writ routing`

This paid command finds nested `SKILL.md` files only under top-level `skills/` and `user-skills/`. It validates all applicable frontmatter before requests, skips `disable-model-invocation: true`, and sends only each skill's `name` and `description` to exact model `jev-1.13.0`. Bodies, paths, other frontmatter, and repository context are not sent.

Five frozen Noul judgments cover capability and activation presence/specificity plus routing focus. Findings and unknowns are advisory and exit 0. Invalid metadata, provider failures, malformed responses or token usage, and model mismatch are fatal and exit 1. The final receipt reports model, token, evaluated, and skipped counts. The TypeSafe client is created only when an applicable skill requires a request.

### `writ references`

This command deterministically discovers relative local Markdown links and backticked relative `.md` paths in the same scope as `writ check`. Missing Markdown links are fatal before any paid request. Existing references and missing backticked paths may require paid semantic judgments; independent questions for one source file are batched into one request.

Privacy is strict: shared state is empty, source paths and repository context are not sent, and target existence is checked with filesystem metadata. Writ never reads or sends referenced target content. Requests contain only the occurrence heading, instruction span, exact link text/target, and relative path where applicable.

Semantic findings and unknowns are advisory and exit 0. Parse, provider, exact-model, integer-token, answer-shape, probability, and deterministic missing-link failures exit 1. The receipt reports scanned files, occurrences, paid requests, and aggregate tokens. Zero scoped files, zero occurrences, and deterministic missing-link failures do not create a TypeSafe client.

### `writ questions`

This paid command validates the frozen routing and reference contracts and dependencies, then runs their calibration corpus against exact model `jev-1.13.0`. Calibration mismatches and unknowns are fatal; meta findings and unknowns are advisory. Its receipt reports requests, calibration totals, meta results, and token usage. It does not inspect a consumer repository.

## Credentials and cost

`writ check` is deterministic, offline, and free of model calls. `routing`, `references` when semantic work remains, and `questions` use TypeSafe and may incur provider charges. Configure the SDK before running paid commands:

```sh
export TYPESAFE_API_KEY=your-key
```

Tests and package checks use injected fake clients or deterministic commands and make no live TypeSafe calls.

## First consumer wrappers

A first consumer can make the intended root explicit in package scripts:

```json
{
  "scripts": {
    "instructions:check": "writ check --root .",
    "instructions:routing": "writ routing --root .",
    "instructions:references": "writ references --root .",
    "instructions:questions": "writ questions"
  }
}
```

A wrapper for another checkout can rely on caller-relative resolution:

```sh
#!/bin/sh
exec pnpm exec writ check --root ../agent-repository
```

## Current limitations

- Semantic commands require TypeSafe availability and the pinned model `jev-1.13.0`.
- Semantic results are probabilistic; Writ preserves the documented advisory/fatal policy rather than treating every finding as a build failure.
- The repository scope is intentionally fixed. Writ does not discover arbitrary instruction locations or consume user-defined lint configuration.
- Reference analysis covers relative Markdown links and backticked relative `.md` paths; it is not a general dependency scanner.

## Development

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs offline tests, validates package metadata and packed contents, and installs the packed tarball into a temporary consumer to smoke-test the actual `writ` bin for help, version, and deterministic checking.

## License

MIT
