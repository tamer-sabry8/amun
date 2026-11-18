// Hand-written surface the daemon uses; the bundle in dist/ is built from src/.
export interface WorkStoreLike {
  snapshot(): unknown;
  handle(input: unknown): unknown[];
}
/** Masks registered secrets and common credential shapes in text and objects. */
export declare class Redactor {
  register(secret: string): void;
  text(value: string): string;
  clean(input: unknown): unknown;
}
/** Products, their mapped sources, PRDs and priorities. */
export interface WorkspaceLike {
  snapshot(): unknown;
  handle(input: unknown): unknown;
}
export interface AdoConnectionRef {
  kind: string;
  baseUrl: string;
}
export interface AdoAccess {
  connections(): Promise<AdoConnectionRef[]>;
  secret(connection: AdoConnectionRef): Promise<string | null>;
  fetch?: typeof fetch;
}
/** Azure DevOps backlog reads and governed writes for a product. */
export interface AdoServiceLike {
  handle(message: unknown): Promise<Record<string, unknown> | null>;
}
export interface OpenedWorkStore {
  store: WorkStoreLike;
  workspace: WorkspaceLike;
  redactor: Redactor;
  close(): void;
}
export declare function openWorkStore(
  file: string,
  redactor?: Redactor,
): OpenedWorkStore;
export declare function openAdo(
  opened: OpenedWorkStore,
  access: AdoAccess,
): AdoServiceLike;
