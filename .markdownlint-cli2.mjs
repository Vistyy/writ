import localLinksExist from "./rules/local-links-exist.mjs";

export default {
  config: {
    default: false,
    MD001: true,
    MD005: true,
    MD011: true,
    MD018: true,
    MD023: true,
    MD042: true,
    MD051: true,
    MD052: true,
    "local-links-exist": {
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
