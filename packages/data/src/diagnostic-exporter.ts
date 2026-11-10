import type Database from "better-sqlite3";
import {
  diagnosticEvent,
  type DiagnosticEvent,
} from "../../contracts/src/diagnostic.ts";

type Measurement = Readonly<
  Pick<DiagnosticEvent, "event" | "subject" | "elapsedMs">
>;

export interface DiagnosticExporter {
  export(measurement: Measurement): void | Promise<void>;
}

export function recordDiagnostics(exporter: DiagnosticExporter) {
  return (input: unknown): void => {
    const parsed = diagnosticEvent.safeParse(input);
    if (!parsed.success) return;
    const { event, subject, elapsedMs } = parsed.data;
    try {
      const pending = exporter.export({ event, subject, elapsedMs });
      void pending?.catch(() => {});
    } catch {
      // Diagnostics failures must neither interrupt work nor expose raw errors.
    }
  };
}

export function sqliteDiagnosticExporter(
  workspace: Database.Database,
): DiagnosticExporter {
  return {
    export({ event, subject, elapsedMs }) {
      workspace
        .prepare(
          "INSERT INTO diagnostic_events(event,subject,elapsed_ms) VALUES(?,?,?)",
        )
        .run(event, subject, elapsedMs);
    },
  };
}
