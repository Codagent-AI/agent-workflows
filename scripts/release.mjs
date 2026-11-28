// Makes the release for the version in VERSION. Run from the repository root by
// the release workflow, which needs GH_TOKEN with contents: write and GITHUB_SHA,
// and passes the push's commits as BEFORE_SHA and AFTER_SHA (a full-history checkout).
// It releases only when that push changed VERSION, so adding this workflow, or any
// other merge, releases nothing. A push without both variables fails. A local run, or
// a manual workflow_dispatch run to recover from a failed release, passes neither and
// relies on the tag check alone.
//
//   node scripts/release.mjs            checks, builds the assets, creates the release
//   node scripts/release.mjs --dry-run  does everything except create the tag and release
//
// It exits without doing anything when the tag v<version> exists, so a rerun is
// safe. The release is a draft until its assets are up, and publishing the draft
// creates the tag at GITHUB_SHA. A draft left by a failed run is replaced.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dryRun = process.argv.includes("--dry-run");
const repo = process.env.GITHUB_REPOSITORY ?? "Codagent-AI/agent-workflows";
const serverDir = "human-workflows/openspec/server";

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], ...options });
const runShown = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", ...options });

function versionUnchanged(from, to) {
  try {
    execFileSync("git", ["diff", "--quiet", from, to, "--", "VERSION"], { stdio: ["ignore", "ignore", "inherit"] });
    return true;
  } catch (error) {
    if (error.status === 1) return false;
    throw new Error(`Cannot compare ${from} with ${to}. Check that the full history is checked out.`, { cause: error });
  }
}

const version = readFileSync("VERSION", "utf8").trim();
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`VERSION must be MAJOR.MINOR.PATCH, but it is "${version}".`);
  process.exit(1);
}
const tag = `v${version}`;

const { BEFORE_SHA: before, AFTER_SHA: after } = process.env;
if (process.env.GITHUB_EVENT_NAME === "push" && !(before && after)) {
  console.error("BEFORE_SHA and AFTER_SHA are required for a push.");
  process.exit(1);
}
if (before && after) {
  // An all-zero before means a new branch, which has no earlier VERSION to compare.
  const changed = /^0+$/.test(before) || !versionUnchanged(before, after);
  if (!changed) {
    console.log("The push did not change VERSION, so there is nothing to release.");
    process.exit(0);
  }
}

if (run("git", ["ls-remote", "--tags", "origin", `refs/tags/${tag}`]).trim() !== "") {
  console.log(`Tag ${tag} exists, so there is nothing to release.`);
  process.exit(0);
}

// The changelog section for this version, without its heading.
function changelogSection() {
  const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
  const start = lines.indexOf(`## ${version}`);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}
const notes = changelogSection();
if (notes === "") {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}

console.log("Checking versions and the define plugin bundle.");
runShown("node", ["scripts/sync-versions.mjs", "--check"]);
if (!existsSync(join(serverDir, "node_modules"))) {
  runShown("npm", ["ci", "--no-audit", "--no-fund", "--silent"], { cwd: serverDir });
}
runShown("node", ["scripts/build.mjs", "--check"], { cwd: serverDir });

if (!dryRun && !process.env.GITHUB_SHA) {
  console.error("GITHUB_SHA is not set.");
  process.exit(1);
}

const out = mkdtempSync(join(tmpdir(), "agent-workflows-release-"));
try {
  const asset = `agent-workflows-pack_${version}.tar.gz`;
  run("tar", ["-czf", join(out, asset), "-C", "factory-workflows/archon", ".archon"]);
  const digest = createHash("sha256").update(readFileSync(join(out, asset))).digest("hex");
  writeFileSync(join(out, "checksums.txt"), `${digest}  ${asset}\n`);
  writeFileSync(join(out, "notes.md"), `${notes}\n`);

  if (dryRun) {
    console.log(`Dry run: would release ${tag} with ${asset} and checksums.txt. Notes:\n\n${notes}\n`);
    console.log(`Tarball starts with:\n${run("tar", ["-tzf", join(out, asset)]).split("\n").slice(0, 5).join("\n")}`);
    console.log(`checksums.txt:\n${readFileSync(join(out, "checksums.txt"), "utf8")}`);
  } else {
    // Drafts are found through the API: a draft has no tag, so the tag lookups of
    // `gh release view` and `gh release edit` may not see it, and GitHub allows several
    // drafts for one tag name. A failed lookup stops the run instead of being ignored.
    const draftIds = () =>
      run("gh", [
        "api", "--paginate", `repos/${repo}/releases`,
        "--jq", `.[] | select(.draft and .tag_name == "${tag}") | .id`,
      ]).split("\n").filter(Boolean);
    for (const id of draftIds()) run("gh", ["api", "-X", "DELETE", `repos/${repo}/releases/${id}`]);
    runShown("gh", [
      "release", "create", tag, "--repo", repo, "--draft", "--target", process.env.GITHUB_SHA, "--title", tag,
      "--notes-file", join(out, "notes.md"), join(out, asset), join(out, "checksums.txt"),
    ]);
    const created = draftIds();
    if (created.length !== 1) throw new Error(`Expected one draft release for ${tag}, found ${created.length}.`);
    run("gh", ["api", "-X", "PATCH", `repos/${repo}/releases/${created[0]}`, "-F", "draft=false"]);
    console.log(`Released ${tag}.`);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
