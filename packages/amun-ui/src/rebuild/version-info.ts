// The version shown under Settings > About. The build injects the values
// (see apps/desktop/vite.renderer.config.ts); none of them is a secret.
export type BuildInfo = {
  version: string;
  displayVersion: string;
  commit: string;
  builtAt: string;
};
export type SystemInfo = { macos: string; arch: string };

declare const __AMUN_BUILD__: BuildInfo | undefined;

export const buildInfo: BuildInfo =
  typeof __AMUN_BUILD__ === "undefined"
    ? {
        version: "0.0.0",
        displayVersion: "Development",
        commit: "unknown",
        builtAt: "",
      }
    : __AMUN_BUILD__;

export const versionLine = (info: BuildInfo) =>
  `Version ${info.displayVersion} (${info.version})`;

export function buildDate(info: BuildInfo): string {
  const date = new Date(info.builtAt);
  return Number.isNaN(date.getTime())
    ? "unknown"
    : date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
}

export function versionDetails(info: BuildInfo, system: SystemInfo): string {
  return [
    `Amun ${info.displayVersion} (${info.version})`,
    `Build ${info.commit}${info.builtAt ? `, ${info.builtAt.slice(0, 10)}` : ""}`,
    `macOS ${system.macos}`,
    `Chip ${system.arch}`,
  ].join("\n");
}

type UserAgentData = {
  getHighEntropyValues(hints: string[]): Promise<Record<string, string>>;
};

export async function readSystem(): Promise<SystemInfo> {
  const data = (navigator as { userAgentData?: UserAgentData }).userAgentData;
  const values = await data
    ?.getHighEntropyValues(["architecture", "platformVersion"])
    .catch(() => ({}) as Record<string, string>);
  const arch = values?.architecture;
  return {
    macos: values?.platformVersion || "unknown",
    arch:
      arch === "arm" ? "Apple silicon (arm64)" : arch ? `${arch}` : "unknown",
  };
}
