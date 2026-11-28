// Bundles src/main.ts into ../plugin/server.mjs. With --check, builds to a temporary file and fails
// when the committed bundle differs from a fresh build.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const serverDir = dirname(dirname(fileURLToPath(import.meta.url)));
const committed = join(serverDir, "..", "plugin", "server.mjs");
const check = process.argv.includes("--check");

// The repository's root VERSION file is the one place the version is set. The server reports it,
// and the files that carry a version must match it, or the build stops. Change them with
// `node scripts/sync-versions.mjs` at the repository root.
const readJson = (...parts) => JSON.parse(readFileSync(join(serverDir, ...parts), "utf8"));
const version = readFileSync(join(serverDir, "..", "..", "..", "VERSION"), "utf8").trim();
for (const other of [
  ["..", "plugin", ".claude-plugin", "plugin.json"],
  ["..", "plugin", ".codex-plugin", "plugin.json"],
  ["package.json"],
]) {
  if (readJson(...other).version !== version) {
    console.error(`${other.join("/")} has version ${readJson(...other).version}, but VERSION has ${version}. Run \`node scripts/sync-versions.mjs\` at the repository root.`);
    process.exit(1);
  }
}
const scratch = check ? mkdtempSync(join(tmpdir(), "define-openspec-change-build-")) : undefined;
const outfile = scratch ? join(scratch, "server.mjs") : committed;

await build({
  entryPoints: [join(serverDir, "src", "main.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  legalComments: "eof",
  define: { __SERVER_VERSION__: JSON.stringify(version) },
  logLevel: "warning",
  banner: {
    js: [
      "// Generated from human-workflows/openspec/server by `npm run build`. Do not edit.",
      'import { createRequire as __defineCreateRequire } from "node:module";',
      "const require = __defineCreateRequire(import.meta.url);",
    ].join("\n"),
  },
});

if (scratch) {
  const fresh = readFileSync(outfile);
  let current;
  try {
    current = readFileSync(committed);
  } catch {
    current = undefined;
  }
  rmSync(scratch, { recursive: true, force: true });
  if (!current?.equals(fresh)) {
    console.error("plugin/server.mjs does not match a fresh build. Run `npm run build` and commit the result.");
    process.exit(1);
  }
  console.log("plugin/server.mjs matches a fresh build.");
}
