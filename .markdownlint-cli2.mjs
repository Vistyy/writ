export default {
  config: { default: false },
  customRules: [],
  frontMatter: String.raw`(^---\s*$[^]*?^---\s*$)(\r\n|\r|\n|$)`,
  globs: ["../AGENTS.md", "../skills/**/*.md", "../user-skills/**/*.md"],
  noBanner: true,
  noProgress: true,
};
