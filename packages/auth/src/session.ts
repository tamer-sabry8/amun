import {
  authCommand,
  type AuthCommand,
  type AuthEvent,
} from "../../contracts/src/auth.ts";
import { AuthBroker, connectionId, type Connection } from "./broker.ts";
export interface LoginProcess {
  answer(id: string, value: string): void;
  stop(): void;
}
export type StartLogin = (
  command: Extract<AuthCommand, { action: "login" }>,
  send: (event: AuthEvent) => void,
  done: () => void,
) => LoginProcess;
export class AuthSession {
  private readonly broker: AuthBroker;
  private readonly metadata: {
    list(): Connection[];
    save(connection: Connection): void;
    remove(connection: Connection): void;
  };
  private readonly send: (event: AuthEvent) => void;
  private readonly start: StartLogin;
  private readonly readiness: (
    provider: string,
  ) => Promise<"configured" | "missing" | "error">;
  private login: LoginProcess | undefined;
  private closed = false;
  private generation = 0;
  constructor(
    broker: AuthBroker,
    metadata: AuthSession["metadata"],
    send: (event: AuthEvent) => void,
    start: StartLogin,
    readiness: AuthSession["readiness"] = async () => "error",
  ) {
    this.broker = broker;
    this.metadata = metadata;
    this.send = (event) => {
      if (!this.closed) send(event);
    };
    this.start = start;
    this.readiness = readiness;
  }
  private list(): void {
    this.send({
      version: 1,
      kind: "auth-connections",
      connections: this.broker.describe(this.metadata.list()),
    });
  }
  async handle(input: unknown): Promise<boolean> {
    const parsed = authCommand.safeParse(input);
    if (!parsed.success || this.closed) return false;
    const command = parsed.data;
    try {
      if (command.action === "readiness") {
        if (this.login) throw Error("Login active");
        this.send({
          version: 1,
          kind: "auth-status",
          id: command.provider,
          status: "checking",
        });
        const status = await this.readiness(command.provider);
        this.send({
          version: 1,
          kind: "auth-status",
          id: command.provider,
          status,
        });
      } else if (command.action === "list") this.list();
      else if (command.action === "save") {
        if (command.connection.kind === "notion")
          throw Error("Use Notion browser sign-in");
        connectionId(command.connection);
        if (
          this.metadata.list().length >= 100 &&
          !this.metadata
            .list()
            .some((c) => connectionId(c) === connectionId(command.connection))
        )
          throw Error("Connection limit");
        this.metadata.save(command.connection);
        this.broker.save(command.connection, command.secret);
        this.list();
      } else if (command.action === "check") {
        await this.broker.check(command.connection);
        this.list();
      } else if (command.action === "forget") {
        this.broker.forget(command.connection);
        this.metadata.remove(command.connection);
        this.list();
      } else if (command.action === "login") {
        if (this.login) throw Error("Login already active");
        const generation = ++this.generation;
        this.login = this.start(command, this.send, () => {
          if (this.generation === generation) this.login = undefined;
        });
      } else if (command.action === "answer")
        this.login?.answer(command.id, command.answer);
      else if (command.action === "cancel") {
        this.generation++;
        this.login?.stop();
        this.login = undefined;
      }
    } catch {
      this.send({
        version: 1,
        kind: "auth-notice",
        message:
          "Connection operation could not be completed. Check the connection or try signing in again.",
      });
    }
    return true;
  }
  close(): void {
    this.closed = true;
    this.generation++;
    this.login?.stop();
    this.login = undefined;
  }
}
