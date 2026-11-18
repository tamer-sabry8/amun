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
export interface OpenedWorkStore {
  store: WorkStoreLike;
  redactor: Redactor;
  close(): void;
}
export declare function openWorkStore(
  file: string,
  redactor?: Redactor,
): OpenedWorkStore;
