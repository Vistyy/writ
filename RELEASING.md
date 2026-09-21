# Releasing Writ

This repository-only guide owns the contributor release procedure. It is not included in the installed package.

## Prepare

1. Update the version in `package.json`.
2. Update version-specific documentation when applicable.
3. Run `pnpm check`.
4. Commit the release change and push it to `main`.

## Publish

Push the matching `v<version>` tag.

GitHub Actions verifies that the tag matches `package.json`, installs and checks with pnpm, packs the verified package, and publishes that tarball through npm trusted publishing. The npm CLI is only the OIDC publication transport; pnpm owns installation and packing.

The npm trusted publisher must be configured for:

- GitHub owner: `Vistyy`
- repository: `writ`
- workflow: `publish.yml`
- environment: none

Do not push a release tag until that publisher is configured. If publication fails after a tag is pushed, inspect both the GitHub Actions run and npm registry state before deciding whether any retry or new version is appropriate.
