export const copilotProvider = "github-copilot";
export const copilotDefaultModel = "claude-sonnet-5.5";
/** The one provider-qualified model Amun routes crew and supervision work to by default. */
export const copilotModelSelector = `${copilotProvider}/${copilotDefaultModel}`;

/**
 * Test-only declaration. The e2e launcher lists the fixture providers its specs
 * register; production, packaged and unset runs get none, so Copilot alone applies.
 */
export const testProvidersVariable = "AMUN_E2E_TEST_PROVIDERS";
export function testProviders(
  env: Record<string, string | undefined>,
): string[] {
  return (env[testProvidersVariable] ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(id));
}
/** Providers whose models may be listed and chosen: Copilot, plus declared test fixtures. */
export function allowedProviders(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return [copilotProvider, ...testProviders(env)];
}
/** Copilot is not signed in or lacks the model; the owner can fix it by signing in. */
export class CopilotUnavailable extends Error {}

/**
 * Picks the GitHub Copilot model for a native Pi session: the owner's saved
 * Copilot choice when it is available, otherwise the pinned default. Another
 * provider is never used; an unavailable Copilot connection is an error.
 */
export function chooseCopilotModel<T extends { provider: string; id: string }>(
  available: readonly T[],
  saved: { provider?: string | undefined; model?: string | undefined },
  declaredTest: readonly string[] = [],
): T | undefined {
  const copilot = available.filter((m) => m.provider === copilotProvider);
  const pick =
    (saved.provider === copilotProvider
      ? copilot.find((m) => m.id === saved.model)
      : undefined) ?? copilot.find((m) => m.id === copilotDefaultModel);
  if (!pick && declaredTest.length) {
    // The e2e harness declared its fixtures: use one it registered, or start with no model.
    const fixture = available.filter((m) => declaredTest.includes(m.provider));
    return (
      fixture.find(
        (m) => m.provider === saved.provider && m.id === saved.model,
      ) ?? fixture[0]
    );
  }
  if (!pick)
    throw new CopilotUnavailable(
      "GitHub Copilot is not connected or its model is unavailable. Sign in to GitHub Copilot under Settings › Accounts and models.",
    );
  return pick;
}

/** Session start: the Pi SDK's own runtime and settings decide what is available and saved. */
export async function selectCopilotModel(
  runtime: {
    getAvailable(
      provider: string,
    ): Promise<readonly { provider: string; id: string }[]>;
  },
  settings: {
    getDefaultProvider(): string | undefined;
    getDefaultModel(): string | undefined;
  },
  declaredTest: readonly string[] = [],
) {
  const available = [
    ...(await runtime.getAvailable(copilotProvider)),
    ...(
      await Promise.all(declaredTest.map((id) => runtime.getAvailable(id)))
    ).flat(),
  ];
  return chooseCopilotModel(
    available,
    {
      provider: settings.getDefaultProvider(),
      model: settings.getDefaultModel(),
    },
    declaredTest,
  );
}
