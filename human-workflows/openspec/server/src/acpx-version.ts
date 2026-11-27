import { onPath, SETUP_HINT } from "./config.js";
import { run } from "./proc.js";

export function supportedAcpxVersion(output: string): boolean {
  const version = output.trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-[\w.-]+)?(?:\+[\w.-]+)?$/);
  if (!version) {
    return false;
  }
  const [, major, minor, patch, prerelease] = version;
  return Number(major) > 0 || Number(minor) > 23 || (Number(minor) === 23 && (Number(patch) > 0 || prerelease === undefined));
}

export class AcpxVersion {
  private usable = false;

  async refusal(cwd: string, env: NodeJS.ProcessEnv): Promise<string | undefined> {
    if (!this.usable && onPath("acpx", env)) {
      const result = await run("acpx", ["--version"], { cwd, env, timeoutMs: 5_000 });
      this.usable = result.code === 0 && supportedAcpxVersion(result.stdout);
    }
    return this.usable ? undefined : `Crosscheck requires acpx 0.23 or later on PATH. ${SETUP_HINT}`;
  }
}
