// Writes the root VERSION file's version into every file that carries one.
// With --check, writes nothing and exits 1 when any of them differs.
//
// Files: both plugin manifests of each plugin, the define plugin's
// server/package.json and package-lock.json, and the entries in the Claude
// Code marketplace. The Codex marketplace has no version field, so it is left alone.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const check = process.argv.includes("--check");

const version = readFileSync(join(root, "VERSION"), "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION must be MAJOR.MINOR.PATCH, but it is "${version}".`);
  process.exit(1);
}

const plugins = ["human-workflows/openspec", "human-workflows/archon"];
const marketplace = JSON.parse(readFileSync(join(root, ".claude-plugin/marketplace.json"), "utf8"));

// Each target is a file and the key paths inside it that hold the version.
const targets = [
  ...plugins.flatMap((dir) => [
    { file: `${dir}/plugin/.claude-plugin/plugin.json`, paths: [["version"]] },
    { file: `${dir}/plugin/.codex-plugin/plugin.json`, paths: [["version"]] },
  ]),
  { file: "human-workflows/openspec/server/package.json", paths: [["version"]] },
  {
    file: "human-workflows/openspec/server/package-lock.json",
    paths: [["version"], ["packages", "", "version"]],
  },
  {
    file: ".claude-plugin/marketplace.json",
    paths: marketplace.plugins.map((_, i) => ["plugins", i, "version"]),
  },
];

const get = (obj, path) => path.reduce((node, key) => node?.[key], obj);
const set = (obj, path, value) => {
  get(obj, path.slice(0, -1))[path.at(-1)] = value;
};

let differs = 0;
for (const { file, paths } of targets) {
  const full = join(root, file);
  if (!existsSync(full)) {
    console.error(`${file} is missing.`);
    differs++;
    continue;
  }
  const data = JSON.parse(readFileSync(full, "utf8"));
  let changed = false;
  for (const path of paths) {
    const found = get(data, path);
    if (found === version) continue;
    changed = true;
    console.log(`${file} ${path.join(".")}: ${found ?? "(none)"} -> ${version}`);
    if (!check) set(data, path, version);
  }
  if (changed) differs++;
  if (changed && !check) writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`);
}

if (check && differs > 0) {
  console.error(`${differs} file(s) differ from VERSION (${version}). Run \`node scripts/sync-versions.mjs\`.`);
  process.exit(1);
}
console.log(check ? `All files match VERSION (${version}).` : `Synced ${differs} file(s) to ${version}.`);
