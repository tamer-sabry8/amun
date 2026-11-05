/** Pi's protocol is LF-delimited; Unicode separators inside content are not frames. */
export class JsonLineDecoder {
  private buffer = "";
  private readonly limit: number;
  constructor(limit = 1048576) {
    this.limit = limit;
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new RangeError("Invalid frame limit");
  }
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const frames: unknown[] = [];
    try {
      let end: number;
      while ((end = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        if (Buffer.byteLength(line, "utf8") > this.limit)
          throw new RangeError("RPC frame too large");
        if (line.trim()) frames.push(JSON.parse(line));
      }
      if (Buffer.byteLength(this.buffer, "utf8") > this.limit)
        throw new RangeError("RPC frame too large");
      return frames;
    } catch (error) {
      this.buffer = "";
      throw error;
    }
  }
  finish(): void {
    if (this.buffer.length) {
      this.buffer = "";
      throw new Error("Incomplete RPC frame");
    }
  }
}
