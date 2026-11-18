import {
  authCommand,
  modelLoginOptions,
  type AuthCommand,
} from "../../contracts/src/auth.ts";
export function nativePiLoginChoice(argument: string):
  | Extract<AuthCommand, { action: "login" }>
  | {
      kind: "choices";
      title: string;
      choices: { id: string; label: string }[];
    } {
  if (!argument)
    return {
      kind: "choices",
      title: "Choose an Amun Pi sign-in",
      choices: modelLoginOptions.map((option) => ({
        id: option.provider + ":" + option.type,
        label:
          option.label + (option.type === "oauth" ? " — browser sign-in" : ""),
      })),
    };
  const option = modelLoginOptions.find(
    (option) => option.provider + ":" + option.type === argument,
  );
  if (!option) throw Error("Unsupported Pi sign-in choice");
  const parsed = authCommand.parse({
    version: 1,
    kind: "auth",
    action: "login",
    provider: option.provider,
    type: option.type,
  });
  if (parsed.action !== "login") throw Error("Invalid Pi sign-in route");
  return parsed;
}
