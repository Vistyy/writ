import relativeLinks from "markdownlint-rule-relative-links";

export default {
  config: {
    default: false, // Disable all built-ins, then opt into only the checks below.
    MD001: true, // Reject heading levels that skip deeper levels.
    MD011: true, // Reject reversed link syntax such as (text)[target].
    MD018: true, // Require a space after # in ATX headings.
    MD040: true, // Require fenced code blocks to declare their language.
    MD042: true, // Reject links with no destination.
    MD047: true, // Require files to end with one newline.
    MD051: true, // Require same-file fragments to match an anchor.
    MD052: true, // Require reference links and images to have definitions.
    MD056: true, // Require each table row to have the same number of columns.
    "relative-links": true, // Require relative files and fragments to resolve.
  },
  customRules: [relativeLinks],
  frontMatter: String.raw`^---[^\S\r\n]*(?:\r\n|\r|\n)[\s\S]*?(?:\r\n|\r|\n)---[^\S\r\n]*(?:\r\n|\r|\n|$)`,
  globs: [
    "../AGENTS.md",
    "../SYSTEM.md",
    "../APPEND_SYSTEM.md",
    "../skills/**/*.md",
    "../user-skills/**/*.md",
  ],
  noBanner: true,
  noProgress: true,
};
