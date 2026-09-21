import { execFileSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const directory of ["bin", "src", "test", "scripts"]) {
  for (const name of (await readdir(join(root, directory))).filter((entry) => entry.endsWith(".mjs")).sort()) {
    execFileSync(process.execPath, ["--check", join(root, directory, name)], { stdio: "inherit" });
  }
}
console.log("SYNTAX ok");
