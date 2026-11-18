import type { AzureProcessSchema } from "../../contracts/src/backlog.ts";
export type FieldValues = Record<string, string | number | boolean>;
export function requiredInputs(
  type: AzureProcessSchema["types"][number],
  values: FieldValues,
) {
  const aliases: Record<string, string> = {
    "System.AreaId": "System.AreaPath",
    "System.IterationId": "System.IterationPath",
  };
  return type.fields
    .filter((f) => {
      if (!f.required) return false;
      const key = aliases[f.referenceName] ?? f.referenceName;
      const value = Object.hasOwn(values, key) ? values[key] : f.defaultValue;
      return value == null || (typeof value === "string" && !value.trim());
    })
    .map((f) => f.referenceName);
}
