# Instruction lint

Local Markdown linting for the agent instructions owned by this repository.

The configured scope includes `AGENTS.md`, optional Pi system-prompt files, skills and their references, and user skills.

The enabled deterministic checks cover Markdown structure that affects parsing (`MD001`, `MD005`, `MD011`, `MD018`, and `MD023`) and link integrity (`MD042`, `MD051`, `MD052`, and the local `local-links-exist` rule). The local rule checks concrete relative file destinations, but not external URLs or fragments in another file. Intentional fictional links used by documentation templates are excluded explicitly in the configuration.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm check
```
