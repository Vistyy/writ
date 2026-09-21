import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
assert.equal(pkg.name, "@syzom/writ");
assert.equal(pkg.version, "0.1.0");
assert.equal(pkg.type, "module");
assert.equal(pkg.packageManager, "pnpm@11.25.0");
assert.deepEqual(pkg.engines, { node: ">=22" });
assert.deepEqual(pkg.publishConfig, { access: "public" });
assert.deepEqual(pkg.bin, { writ: "bin/writ.mjs" });
assert.deepEqual(pkg.files, ["bin/", "src/", "README.md", "LICENSE"]);
assert.equal(pkg.license, "MIT");
assert.deepEqual(pkg.dependencies, {
  "@typesafe-ai/sdk": "0.6.0",
  "markdown-it": "15.0.2",
  "markdownlint-cli2": "0.23.3",
  "markdownlint-rule-relative-links": "5.1.2",
  yaml: "2.8.2",
});
assert.equal(pkg.devDependencies, undefined);

const destination = await mkdtemp(join(tmpdir(), "writ-pack-"));
try {
  const packed = JSON.parse(execFileSync("pnpm", ["pack", "--pack-destination", destination, "--json"], { cwd: root, encoding: "utf8" }));
  const actual = packed.files.map(({ path }) => path).sort();
  const expected = [
    "LICENSE", "README.md", "bin/writ.mjs", "package.json", "src/cli.mjs", "src/markdown-check.mjs",
    "src/question-check.mjs", "src/question-contracts.mjs", "src/reference-contracts.mjs", "src/reference-lint.mjs", "src/semantic-lint.mjs",
  ].sort();
  assert.deepEqual(actual, expected);
  console.log(`PACK ${packed.filename}`);
  for (const path of actual) console.log(path);
} finally {
  await rm(destination, { recursive: true, force: true });
}
