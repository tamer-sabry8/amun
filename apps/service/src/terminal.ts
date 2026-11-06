import { terminalCommand, type TerminalEvent } from "@amun/contracts";
export interface Pty {
  setControl?(enabled: boolean): Promise<void>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(listener: (data: string) => void): unknown;
  onExit(listener: () => void): unknown;
}
export class TerminalSession {
  private pty: Pty | undefined;
  private control = false;
  private controlEpoch = 0;
  private outputSize = 0;
  private spawn: () => Pty;
  private send: (event: TerminalEvent) => void;
  constructor(spawn: () => Pty, send: (event: TerminalEvent) => void) {
    this.spawn = spawn;
    this.send = send;
  }
  private state(state: "readonly" | "control" | "closed" | "unavailable") {
    this.send({ version: 1, kind: "terminal-state", state });
  }
  handle(input: unknown): void {
    const parsed = terminalCommand.safeParse(input);
    if (!parsed.success) return;
    const command = parsed.data;
    try {
      if (command.action === "open") {
        if (this.pty) return;
        const pty = this.spawn();
        this.pty = pty;
        this.control = false;
        this.outputSize = 0;
        pty.onData((data) => {
          if (this.pty !== pty) return;
          this.outputSize += data.length;
          if (this.outputSize > 1048576) {
            this.close();
            this.state("unavailable");
            return;
          }
          for (let offset = 0; offset < data.length; offset += 65536)
            this.send({
              version: 1,
              kind: "terminal-data",
              data: data.slice(offset, offset + 65536),
            });
        });
        pty.onExit(() => {
          if (this.pty === pty) {
            this.pty = undefined;
            this.control = false;
            this.state("closed");
          }
        });
        this.state("readonly");
        return;
      }
      if (command.action === "close") {
        this.close();
        return;
      }
      if (!this.pty) return;
      if (command.action === "take-control") {
        const pty = this.pty;
        const epoch = ++this.controlEpoch;
        this.control = false;
        const grant = () => {
          if (this.pty === pty && this.controlEpoch === epoch) {
            this.control = true;
            this.state("control");
          }
        };
        if (pty.setControl)
          void pty
            .setControl(true)
            .then(grant)
            .catch(() => {
              if (this.pty === pty) {
                this.close();
                this.state("unavailable");
              }
            });
        else grant();
      } else if (command.action === "release-control") {
        this.control = false;
        this.controlEpoch++;
        const pty = this.pty;
        if (pty.setControl)
          void pty.setControl(false).catch(() => {
            if (this.pty === pty) {
              this.close();
              this.state("unavailable");
            }
          });
        this.state("readonly");
      } else if (command.action === "input" && this.control)
        this.pty.write(command.data);
      else if (command.action === "resize")
        this.pty.resize(command.cols, command.rows);
    } catch {
      this.close();
      this.state("unavailable");
    }
  }
  close(): void {
    const pty = this.pty;
    this.pty = undefined;
    this.controlEpoch++;
    this.control = false;
    try {
      pty?.kill();
    } catch {
      /* own PTY may already have exited */
    }
    this.state("closed");
  }
}
