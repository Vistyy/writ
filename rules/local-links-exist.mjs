import { existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const externalDestination = /^(?:[a-z][a-z\d+.-]*:|\/\/|[/\\~])/iu;
const nonConcreteDestination = /[<>*{}\[\]$]/u;
const destinationTypes = new Set([
  "definitionDestinationString",
  "resourceDestinationString",
]);

function pathFromDestination(destination) {
  if (!destination || destination.startsWith("#") || externalDestination.test(destination)) {
    return undefined;
  }

  const path = destination.split("#", 1)[0].split("?", 1)[0];
  if (!path || nonConcreteDestination.test(path)) {
    return undefined;
  }

  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function isIgnored(config, source, destination) {
  const normalizedSource = source.split(sep).join("/");
  return (config.ignored ?? []).some(
    (entry) =>
      normalizedSource.endsWith(entry.source) &&
      destination === entry.destination,
  );
}

function descendants(token) {
  return (token.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}

function destinationText(token) {
  const text = descendants(token)
    .filter((child) => child.type === "characterEscapeValue" || child.type === "data")
    .map((child) => child.text)
    .join("");
  return text || token.text;
}

/** @type {import("markdownlint").Rule} */
export default {
  names: ["local-links-exist"],
  description: "Local Markdown link destinations should exist",
  tags: ["links"],
  parser: "micromark",
  function: (params, onError) => {
    const source = resolve(params.name);
    const destinations = params.parsers.micromark.tokens.flatMap((token) => [
      token,
      ...descendants(token),
    ]);

    for (const token of destinations) {
      if (!destinationTypes.has(token.type)) {
        continue;
      }

      const destination = destinationText(token);
      const localPath = pathFromDestination(destination);

      if (
        localPath &&
        !isIgnored(params.config, source, destination) &&
        !existsSync(resolve(dirname(source), localPath))
      ) {
        onError({
          lineNumber: token.startLine,
          detail: `Missing local destination: ${destination}`,
          context: token.text,
        });
      }
    }
  },
};
