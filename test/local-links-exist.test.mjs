import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { lint } from "markdownlint/promise";
import localLinksExist from "../rules/local-links-exist.mjs";

async function lintFixture(markdown, ruleConfig = true) {
  const directory = await mkdtemp(join(tmpdir(), "instruction-lint-"));
  const source = join(directory, "source.md");
  await writeFile(source, markdown);
  await writeFile(join(directory, "target.md"), "# Target\n");
  await writeFile(join(directory, "target&name.md"), "# Encoded target\n");

  try {
    const results = await lint({
      files: [source],
      customRules: [localLinksExist],
      config: { default: false, "local-links-exist": ruleConfig },
    });
    return results[source];
  } finally {
    await rm(directory, { recursive: true });
  }
}

test("reports missing concrete local destinations", async () => {
  const errors = await lintFixture([
    "[existing](target.md)",
    "[encoded](target&amp;name.md)",
    "[existing fragment](target.md#missing)",
    "[missing fragment](missing-fragment.md#anchor)",
    "[missing](missing.md)",
    "![missing image](missing.png)",
    "[reference][target]",
    "[missing reference][missing]",
    "",
    "[target]: target.md",
    "[missing]: missing-reference.md",
  ].join("\n"));

  assert.deepEqual(
    errors.map(({ errorDetail, lineNumber }) => ({ errorDetail, lineNumber })),
    [
      {
        errorDetail: "Missing local destination: missing-fragment.md#anchor",
        lineNumber: 4,
      },
      { errorDetail: "Missing local destination: missing.md", lineNumber: 5 },
      { errorDetail: "Missing local destination: missing.png", lineNumber: 6 },
      {
        errorDetail: "Missing local destination: missing-reference.md",
        lineNumber: 11,
      },
    ],
  );
});

test("ignores non-local, non-concrete, fenced, and configured example destinations", async () => {
  const errors = await lintFixture([
    "[web](https://example.com)",
    "[anchor](#target)",
    "[root](/documentation)",
    "[template](<path/to/{document}.md>)",
    "```markdown",
    "[fenced](missing.md)",
    "```",
    "[example](missing.md)",
  ].join("\n"), {
    ignored: [{ source: "source.md", destination: "missing.md" }],
  });

  assert.deepEqual(errors, []);
});
