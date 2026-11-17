export const copilotProvider = "github-copilot";
export const copilotDefaultModel = "claude-sonnet-5.5";
/** The provider-qualified model Amun routes crew and supervision work to by default. */
export const copilotModelSelector = `${copilotProvider}/${copilotDefaultModel}`;

/** All AI providers supported by Amun's Accounts and models settings. */
export const supportedProviders = [
  "github-copilot",
  "openai-codex",
  "openrouter",
  "xai",
  "kimi-coding",
  "meta",
  "openai",
  "anthropic",
  "google",
  "groq",
  "mistral",
  "deepseek",
] as const;

/**
 * Test-only declaration. The e2e launcher lists the fixture providers its specs
 * register; production, packaged and unset runs get none.
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
/** Providers whose models may be listed and chosen: all supported providers, plus declared test fixtures. */
export function allowedProviders(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return [...supportedProviders, ...testProviders(env)];
}
/** No supported provider is signed in or has an available model; the owner can fix it by signing in. */
export class CopilotUnavailable extends Error {}

/**
 * Picks the model for a native Pi session: the owner's saved choice when it is
 * available, otherwise the pinned Copilot default or the first available
 * authenticated model across connected providers.
 */
export function chooseCopilotModel<T extends { provider: string; id: string }>(
  available: readonly T[],
  saved: { provider?: string | undefined; model?: string | undefined },
  declaredTest: readonly string[] = [],
): T | undefined {
  const supported = new Set<string>(supportedProviders);
  const candidates = available.filter((m) => supported.has(m.provider));
  const pick =
    (saved.provider && saved.model
      ? candidates.find(
          (m) => m.provider === saved.provider && m.id === saved.model,
        )
      : undefined) ??
    candidates.find(
      (m) => m.provider === copilotProvider && m.id === copilotDefaultModel,
    ) ??
    (saved.provider
      ? candidates.find((m) => m.provider === saved.provider)
      : undefined) ??
    candidates.find((m) => m.provider === copilotProvider) ??
    candidates[0];
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
  const providers = [...new Set([...supportedProviders, ...declaredTest])];
  const available = (
    await Promise.all(
      providers.map((id) =>
        Promise.resolve(runtime.getAvailable(id)).catch(() => []),
      ),
    )
  ).flat();
  return chooseCopilotModel(
    available,
    {
      provider: settings.getDefaultProvider(),
      model: settings.getDefaultModel(),
    },
    declaredTest,
  );
}

/**
 * The model the prompt box can show without starting the conversation worker:
 * the saved model choice (or the pinned Copilot default) once a provider is signed in.
 * Declared test fixtures pick their own model, so only the conversation knows it.
 */
export function savedModelLabel(
  settings: unknown,
  credentialProviders: readonly string[],
  declaredTest: readonly string[] = [],
): { model: string | null; needsConversation: boolean } {
  if (declaredTest.length) return { model: null, needsConversation: true };
  const supported = new Set<string>(supportedProviders);
  const signedIn = credentialProviders.filter((id) => supported.has(id));
  if (!signedIn.length) return { model: null, needsConversation: false };
  const saved =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>)
      : {};
  if (
    typeof saved.defaultProvider === "string" &&
    signedIn.includes(saved.defaultProvider) &&
    typeof saved.defaultModel === "string" &&
    /^[\w./:-]{1,128}$/.test(saved.defaultModel)
  ) {
    return {
      model: `${saved.defaultProvider}/${saved.defaultModel}`,
      needsConversation: false,
    };
  }
  if (signedIn.includes(copilotProvider))
    return {
      model: `${copilotProvider}/${copilotDefaultModel}`,
      needsConversation: false,
    };
  return { model: null, needsConversation: true };
}
