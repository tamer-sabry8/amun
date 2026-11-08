/** Owns one cancellable operation; teardown waits for its cleanup, never adopts other work. */
export class ScopedOperation {
  private controller: AbortController | undefined;
  private pending: Promise<unknown> | undefined;
  private closed = false;
  async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.closed || this.pending) throw Error("Operation unavailable");
    const controller = new AbortController();
    this.controller = controller;
    const pending = (async () => work(controller.signal))();
    this.pending = pending;
    try {
      return await pending;
    } finally {
      if (this.pending === pending) {
        this.pending = undefined;
        this.controller = undefined;
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    this.controller?.abort();
    await this.pending?.catch(() => {});
  }
}
