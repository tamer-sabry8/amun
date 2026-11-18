// Small pieces shared by the PRD and Backlog views. Layout only; the classes
// are the shell's own (.field, .rb-inline, .row, .btn).
import type { CSSProperties } from "react";

export const stack: CSSProperties = { display: "grid", gap: 10 };
export const divided: CSSProperties = {
  display: "grid",
  gap: 8,
  borderTop: "1px solid var(--line)",
  paddingTop: 10,
};
export const list: CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: "grid",
  gap: 4,
};
export const code: CSSProperties = {
  margin: 0,
  padding: "10px 12px",
  maxHeight: 360,
  overflow: "auto",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  fontFamily: "var(--amun-font-code)",
  fontSize: 12.5,
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--canvas)",
};

export type Option = { id: string; name: string };

export function Choice({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A message the person should notice (kept as an alert for screen readers). */
export function Problem({ id, children }: { id?: string; children: string }) {
  return children ? (
    <p
      id={id}
      role="alert"
      className="small"
      style={{ color: "var(--amun-status-error)" }}
    >
      {children}
    </p>
  ) : null;
}
