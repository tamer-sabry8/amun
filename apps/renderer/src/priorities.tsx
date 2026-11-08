import { useState } from "react";
import type { WorkspaceSnapshot } from "@amun/contracts";
import { bridge } from "./bridge.ts";
export function Priorities({
  context,
}: {
  context: NonNullable<WorkspaceSnapshot["productContext"]>;
}) {
  const [selected, select] = useState<string>(() => crypto.randomUUID());
  const item = context.priorities.find((p) => p.id === selected);
  return (
    <section>
      <h2>RICE priorities</h2>
      <table aria-label="Priorities ordered by RICE score">
        <thead>
          <tr>
            {[
              "Objective",
              "Release",
              "Status",
              "Reach / quarter",
              "Impact",
              "Confidence",
              "Effort (person-months)",
              "RICE",
              "Assumption evidence",
            ].map((label) => (
              <th key={label}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {context.priorities.map((row) => (
            <tr key={row.id}>
              <td>
                <button onClick={() => select(row.id)}>{row.objective}</button>
              </td>
              <td>{row.release}</td>
              <td>{row.status}</td>
              <td>{row.reach ?? "—"}</td>
              <td>{row.impact ?? "—"}</td>
              <td>{row.confidence === null ? "—" : row.confidence + "%"}</td>
              <td>{row.effort ?? "—"}</td>
              <td>
                {row.score?.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                }) ?? "Incomplete"}
              </td>
              <td>{row.evidence || "Unverified"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        key={selected}
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const str = (k: string) => String(data.get(k) ?? "").trim(),
            num = (k: string) => (str(k) === "" ? null : Number(str(k)));
          bridge.send({
            version: 1,
            kind: "workspace",
            action: "save-priority",
            productId: context.productId,
            priorityId: selected,
            objective: str("objective"),
            release: str("release"),
            status: str("status"),
            evidence: str("evidence"),
            reach: num("reach"),
            impact: num("impact"),
            confidence: num("confidence"),
            effort: num("effort"),
          });
        }}
      >
        <label>
          Priority objective
          <input
            required
            name="objective"
            defaultValue={item?.objective}
            maxLength={512}
          />
        </label>
        <label>
          Target release
          <input name="release" defaultValue={item?.release} />
        </label>
        <label>
          Priority status
          <select name="status" defaultValue={item?.status}>
            {["Proposed", "Planned", "In progress", "Done"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Reach (people per quarter)
          <input
            type="number"
            min="0"
            step="1"
            name="reach"
            defaultValue={item?.reach ?? ""}
          />
        </label>
        <label>
          Impact (0.25 minimal to 3 massive)
          <select name="impact" defaultValue={item?.impact ?? ""}>
            <option value="">Unknown</option>
            {[0.25, 0.5, 1, 2, 3].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Confidence (%)
          <input
            type="number"
            min="0"
            max="100"
            step="any"
            name="confidence"
            defaultValue={item?.confidence ?? ""}
          />
        </label>
        <label>
          Effort (person-months)
          <input
            type="number"
            min="0"
            step="any"
            name="effort"
            defaultValue={item?.effort ?? ""}
          />
        </label>
        <label>
          Assumption evidence
          <input name="evidence" defaultValue={item?.evidence} />
        </label>
        <button>Save priority</button>
        <button
          type="button"
          onClick={() => {
            select(crypto.randomUUID());
          }}
        >
          New priority
        </button>
      </form>
    </section>
  );
}
