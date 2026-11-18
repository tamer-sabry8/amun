// The part of proper-lockfile the refresh lock uses (it ships no types).
declare module "proper-lockfile" {
  interface LockOptions {
    fs?: object;
    lockfilePath?: string;
    stale?: number;
    update?: number;
    retries?: {
      retries: number;
      minTimeout?: number;
      maxTimeout?: number;
      factor?: number;
    };
  }
  const lockfile: {
    lock(file: string, options?: LockOptions): Promise<() => Promise<void>>;
  };
  export default lockfile;
}
