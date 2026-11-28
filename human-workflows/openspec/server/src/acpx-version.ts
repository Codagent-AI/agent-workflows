import { onPath, SETUP_HINT } from "./config.js";
import { output, type RunResult, run, tail } from "./proc.js";

export function supportedAcpxVersion(versionText: string): boolean {
  const version = versionText.trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[\w.-]+)?(?:\+[\w.-]+)?$/);
  if (!version) {
    return false;
  }
  const [, major, minor, patch, prerelease] = version;
  return Number(major) > 0 || Number(minor) > 23 || (Number(minor) === 23 && (Number(patch) > 0 || prerelease === undefined));
}

const REQUIREMENT = "Crosscheck requires acpx 0.23 or later on PATH.";

export function acpxProbeRefusal(result: RunResult): string | undefined {
  if (result.code === 0) {
    if (supportedAcpxVersion(result.stdout)) {
      return undefined;
    }
    const version = tail(result.stdout);
    const detail = version ? `Detected acpx version: ${version}.` : "acpx --version returned no version.";
    return `${REQUIREMENT} ${detail} ${SETUP_HINT}`;
  }
  const exit = result.code === null ? "killed or timed out" : `exit ${result.code}`;
  const status = result.launchError ? "could not start" : exit;
  const detail = tail(output(result));
  return [`acpx --version failed (${status}).`, detail, SETUP_HINT].filter(Boolean).join(" ");
}

export class AcpxVersion {
  private usable = false;

  async refusal(cwd: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
    if (this.usable) {
      return undefined;
    }
    if (!onPath("acpx", env)) {
      return `${REQUIREMENT} ${SETUP_HINT}`;
    }
    const result = await run("acpx", ["--version"], { cwd, env, timeoutMs: 5_000 });
    const refusal = acpxProbeRefusal(result);
    this.usable = refusal === undefined;
    return refusal;
  }
}
