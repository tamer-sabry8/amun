// Types from Amun Beta 0.9's Notion connector, kept until that connector is
// ported. Only the shapes the workspace layer needs.
import type { RemoteField } from "../../domain/src/memory-sync.ts";

export interface MemoryExchange {
  page: string;
  label: string;
  expectedWorkspace: string | null;
  edit?: { before: string; after: string; assertCurrent(): void };
  done: (remote: RemoteField, workspace: string) => void;
}
export interface NotionConnection {
  memoryField(
    request: Omit<MemoryExchange, "done">,
  ): Promise<{ remote: RemoteField; workspace: string }>;
}
export interface NotionPublication {
  parentId: string;
  markerPropertyId?: string;
  parentType?: "page_id" | "data_source_id";
  titleProperty?: string;
  title: string;
  text: string;
}
