export const copilotProvider = "github-copilot";
export const copilotDefaultModel = "claude-sonnet-5.5";
/** The one provider-qualified model Amun routes crew and supervision work to by default. */
export const copilotModelSelector = `${copilotProvider}/${copilotDefaultModel}`;

/**
 * Picks the GitHub Copilot model for a native Pi session: the owner's saved
 * Copilot choice when it is available, otherwise the pinned default. Another
 * provider is never used; an unavailable Copilot connection is an error.
 */
export function chooseCopilotModel<T extends { provider: string; id: string }>(
  available: readonly T[],
  saved: { provider?: string | undefined; model?: string | undefined },
): T {
  const copilot = available.filter((m) => m.provider === copilotProvider);
  const pick =
    (saved.provider === copilotProvider
      ? copilot.find((m) => m.id === saved.model)
      : undefined) ?? copilot.find((m) => m.id === copilotDefaultModel);
  if (!pick)
    throw Error(
      "GitHub Copilot is not connected or its model is unavailable. Connect GitHub Copilot under Settings › Accounts and models.",
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
) {
  return chooseCopilotModel(await runtime.getAvailable(copilotProvider), {
    provider: settings.getDefaultProvider(),
    model: settings.getDefaultModel(),
  });
}
