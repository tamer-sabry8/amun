// The commands Amun carries out itself: /model and /theme. They answer in the
// same place Firstmate's own commands do, in plain words.
import {
  modelDisplay,
  pickByName,
  themeIds,
} from "../../../../packages/domain/src/work/shell.ts";
import { chooseModel, currentModel, listModels } from "./firstmate.ts";

export interface AppCommandDeps {
  /** Display names of the themes, by id ("system" included). */
  themeNames: Record<string, string>;
  currentTheme: string;
  setTheme(id: string): void;
  models?: typeof listModels;
  choose?: typeof chooseModel;
  current?: typeof currentModel;
}

const few = (names: string[]) =>
  names.slice(0, 8).join(", ") + (names.length > 8 ? ", and more" : "");

async function model(argument: string, deps: AppCommandDeps): Promise<string> {
  const models = await (deps.models ?? listModels)();
  const using = modelDisplay((deps.current ?? currentModel)());
  if (!models.length)
    return "No models are available yet. Sign in to a provider under Settings › Accounts and models.";
  if (!argument)
    return (
      (using ? `Firstmate is using **${using}**. ` : "") +
      "To switch, type `/model` and part of a name, for example `/model opus`, or choose one from the model name in the message box."
    );
  const picked = pickByName(models, argument);
  if ("none" in picked)
    return `No model matches “${argument}”. Type \`/model\` and part of a name, for example \`/model sonnet\`.`;
  if ("several" in picked)
    return `Several models match “${argument}”: ${few(picked.several.map((item) => modelDisplay(item.id) ?? item.label))}. Type more of the name.`;
  const done = await (deps.choose ?? chooseModel)(picked.one.id);
  const name = modelDisplay(picked.one.id) ?? picked.one.label;
  return done
    ? `Firstmate now uses **${name}**.`
    : `**${name}** could not be selected. Try another one.`;
}

function theme(argument: string, deps: AppCommandDeps): string {
  const themes = (["system", ...themeIds] as string[]).map((id) => ({
    id,
    label: deps.themeNames[id] ?? id,
  }));
  const now = deps.themeNames[deps.currentTheme] ?? deps.currentTheme;
  if (!argument)
    return `The theme is **${now}**. To change it, type \`/theme\` and a name, for example \`/theme light\`. The themes are: ${themes.map((item) => item.label).join(", ")}.`;
  const picked = pickByName(themes, argument);
  if ("none" in picked)
    return `No theme matches “${argument}”. The themes are: ${themes.map((item) => item.label).join(", ")}.`;
  if ("several" in picked)
    return `Several themes match “${argument}”: ${few(picked.several.map((item) => item.label))}. Type more of the name.`;
  deps.setTheme(picked.one.id);
  return `The theme is now **${picked.one.label}**.`;
}

/** Carries out /model or /theme and answers with one plain line. */
export function runAppCommand(
  command: { name: string; argument: string },
  deps: AppCommandDeps,
): Promise<string> {
  return command.name === "model"
    ? model(command.argument, deps)
    : Promise.resolve(theme(command.argument, deps));
}
