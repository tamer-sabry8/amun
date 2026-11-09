import type { AdoWriteClient } from "./governed-writes.ts";
export async function editBoardCard(
  input: {
    id: number;
    rev: number;
    title: string;
    type: string;
    column: string;
    columnField: string;
    columns: { name: string; stateMappings: Record<string, string> }[];
  },
  client: Pick<AdoWriteClient, "write">,
) {
  const state = input.columns.find((c) => c.name === input.column)
    ?.stateMappings[input.type];
  if (!state) throw Error("No board mapping for this work item type.");
  return client.write(
    {
      itemId: String(input.id),
      remoteId: input.id,
      revision: input.rev,
      type: input.type,
      parentId: null,
      marker: "",
      fields: {
        "System.Title": input.title,
        "System.State": state,
        [input.columnField]: input.column,
      },
    },
    null,
  );
}
