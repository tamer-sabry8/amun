// Hand-written surface the daemon uses; the bundle in dist/ is built from src/.
export interface WorkStoreLike {
  snapshot(): unknown;
  handle(input: unknown): unknown[];
}
export interface OpenedWorkStore {
  store: WorkStoreLike;
  close(): void;
}
export declare function openWorkStore(file: string): OpenedWorkStore;
