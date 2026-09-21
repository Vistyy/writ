import fs from "node:fs";
import { basename } from "node:path";
import { main as markdownlint } from "markdownlint-cli2";
import relativeLinks from "markdownlint-rule-relative-links";

const CONFIG_NAMES = new Set([
  ".markdownlint-cli2.jsonc", ".markdownlint-cli2.yaml", ".markdownlint-cli2.cjs", ".markdownlint-cli2.mjs",
  ".markdownlint.jsonc", ".markdownlint.json", ".markdownlint.yaml", ".markdownlint.yml", ".markdownlint.cjs", ".markdownlint.mjs",
]);

function deterministicFs() {
  const promises = Object.create(fs.promises);
  promises.access = async (path, ...args) => {
    if (CONFIG_NAMES.has(basename(path))) {
      const error = new Error(`ENOENT: no such file or directory, access '${path}'`);
      error.code = "ENOENT";
      throw error;
    }
    return fs.promises.access(path, ...args);
  };
  return new Proxy(fs, {
    get(target, property) {
      return property === "promises" ? promises : Reflect.get(target, property);
    },
  });
}

export const MARKDOWN_GLOBS = Object.freeze([
  "AGENTS.md",
  "SYSTEM.md",
  "APPEND_SYSTEM.md",
  "skills/**/*.md",
  "user-skills/**/*.md",
]);

export const MARKDOWNLINT_OPTIONS = Object.freeze({
  config: {
    default: false,
    MD001: true,
    MD011: true,
    MD018: true,
    MD040: true,
    MD042: true,
    MD047: true,
    MD051: true,
    MD052: true,
    MD056: true,
    "relative-links": true,
  },
  customRules: [relativeLinks],
  frontMatter: String.raw`^---[^\S\r\n]*(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---[^\S\r\n]*(?:\r\n|\r|\n|$)`,
  gitignore: false,
  ignores: [],
  markdownItPlugins: [],
  noBanner: true,
  noProgress: true,
  overrides: [],
});

export async function runMarkdownCheck({ root, stdout = console.log, stderr = console.error, lint = markdownlint }) {
  try {
    return await lint({
      directory: root,
      argv: [...MARKDOWN_GLOBS],
      noGlobs: true,
      optionsDefault: MARKDOWNLINT_OPTIONS,
      optionsOverride: MARKDOWNLINT_OPTIONS,
      logMessage: stdout,
      logError: stderr,
      fs: deterministicFs(),
    });
  } catch (error) {
    stderr(`ERROR ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
