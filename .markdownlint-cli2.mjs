import localLinksExist from "./rules/local-links-exist.mjs";

export default {
  config: {
    default: false, // Disable all built-ins, then opt into only the checks below.
    MD001: true, // Reject heading levels that skip deeper levels.
    MD011: true, // Reject reversed link syntax such as (text)[target].
    MD018: true, // Require a space after # in ATX headings.
    MD042: true, // Reject links with no destination.
    MD051: true, // Require same-file fragments to match an anchor.
    MD052: true, // Require reference links and images to have definitions.
    "local-links-exist": { // Require concrete relative file/image targets to exist.
      ignored: [
        {
          source: "skills/domain-modeling/references/GLOSSARY-FORMAT.md",
          destination: "./ordering/GLOSSARY.md",
        },
        {
          source: "skills/domain-modeling/references/GLOSSARY-FORMAT.md",
          destination: "./fulfillment/GLOSSARY.md",
        },
      ],
    },
  },
  customRules: [localLinksExist],
  frontMatter: String.raw`(^---\s*$[^]*?^---\s*$)(\r\n|\r|\n|$)`,
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
