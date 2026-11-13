// Settings (handoff §9): accounts and models, tools, groups and routing,
// permissions, Council, skills, themes, data, advanced. Runtime vocabulary
// lives only under Advanced.
import { useState } from "react";
import type { UiPreferences, WorkspaceSnapshot } from "@amun/contracts";
import {
  gateLabels,
  type Gate,
} from "../../../../packages/domain/src/work/permissions.ts";
import { trackerName } from "../../../../packages/domain/src/work/flows.ts";
import { themeIds } from "../../../../packages/domain/src/work/shell.ts";
import { simulationLabel } from "../../../../packages/domain/src/work/council.ts";
import type { CouncilStatus } from "../../../../packages/contracts/src/work.ts";
import { Icon } from "../icons.tsx";
import { BackupControls, Settings as LegacySettings } from "../shell.tsx";
import { NativePiPanel } from "../native-pi-panel.tsx";
import { AgentsPanel } from "../agents-panel.tsx";
import { SkillsLibrary } from "../skills-library.tsx";
import { ModelCards, tools } from "./wizard.tsx";
import { ToolCards } from "./tool-cards.tsx";
import { council, work } from "./store.ts";
import { groupName, shortDate, type Snapshot } from "./view-model.ts";

export const settingsSections = [
  ["models", "Accounts and models"],
  ["tools", "Tools"],
  ["groups", "Groups and routing"],
  ["permissions", "Permissions"],
  ["council", "Council"],
  ["skills", "Skills"],
  ["themes", "Themes"],
  ["data", "Data and backup"],
  ["advanced", "Advanced"],
] as const;
export type SettingsSection = (typeof settingsSections)[number][0];

const themeNames: Record<string, string> = {
  system: "Match macOS",
  "tamer-sabry-default": "Amun dark",
  "navy-gold": "Navy Gold",
  "navy-cyan": "Navy Cyan",
  "amun-light": "Amun light",
};
const conditions = [
  [null, "Everything else"],
  ["delivery", "Client delivery tickets"],
  ["product", "Product work"],
  ["task", "Tasks"],
  ["rfp", "RFPs"],
] as const;
const actions = [
  ["create", "Create items"],
  ["update", "Update items"],
] as const;

export function Settings({
  snapshot,
  workspace,
  councilStatus,
  section,
  onSection,
}: {
  snapshot: Snapshot;
  workspace: WorkspaceSnapshot | null;
  councilStatus: CouncilStatus | null;
  section: SettingsSection;
  onSection(section: SettingsSection): void;
}) {
  const [group, setGroup] = useState("");
  const [permission, setPermission] = useState({
    groupId: "",
    destination: "notion",
    permit: "create",
  });
  const [problem, setProblem] = useState("");
  const trackers = [
    ...tools.map(([id]) => id).filter((id) => id !== "obsidian"),
    "amun",
  ];
  const preferences: UiPreferences = workspace?.preferences ?? {
    theme: "tamer-sabry-default",
    productId: null,
    islandSize: "card",
    pinnedTabs: [],
  };
  return (
    <div className="rb-scroll">
      <div className="rb-page">
        <header className="rb-head">
          <h1>Settings</h1>
        </header>
        <div className="rb-settings">
          <nav aria-label="Settings sections">
            {settingsSections.map(([id, label]) => (
              <button
                key={id}
                className="rb-nav"
                aria-current={section === id ? "page" : undefined}
                onClick={() => onSection(id)}
              >
                <span>{label}</span>
              </button>
            ))}
          </nav>
          {section === "models" && (
            <section aria-labelledby="rb-s-models">
              <h2 id="rb-s-models">Accounts and models</h2>
              <p className="muted">
                One sign-in powers Firstmate and your agents. Status is checked
                when you sign in and once a day when Amun opens.
              </p>
              <ModelCards />
              <ToolCards />
              <h3>Model for each kind of task</h3>
              <p className="muted">
                Firstmate picks a model per task type from the accounts above,
                and every run shows the model it used.
              </p>
              <details>
                <summary className="link">
                  Review coding assistants on this Mac
                </summary>
                <div className="legacy-surface" style={{ marginTop: 10 }}>
                  <NativePiPanel subscriptionsOnly />
                </div>
              </details>
            </section>
          )}
          {section === "tools" && (
            <section aria-labelledby="rb-s-tools">
              <h2 id="rb-s-tools">Tools</h2>
              <p className="muted">
                Connect the tools your team uses. Connecting a tool never lets
                Amun publish to it without the approvals under Permissions.
              </p>
              <div className="legacy-surface">
                <LegacySettings
                  section="connections"
                  preferences={preferences}
                  onPreferences={() => undefined}
                />
              </div>
            </section>
          )}
          {section === "groups" && (
            <section aria-labelledby="rb-s-groups">
              <h2 id="rb-s-groups">Groups and routing</h2>
              <p className="muted">
                A group keeps a context separate: an employer, personal work, a
                side business. Information stays inside its group unless you
                allow a specific use.
              </p>
              <label className="field">
                Working in
                <select
                  value={snapshot.setup.activeGroupId ?? ""}
                  onChange={(event) =>
                    work("setup", {
                      patch: { activeGroupId: event.target.value || null },
                    })
                  }
                >
                  <option value="">Ask me each time</option>
                  {snapshot.groups.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              {snapshot.groups.map((item) => (
                <div
                  className="rb-inline"
                  key={item.id}
                  style={{ maxWidth: "none" }}
                >
                  <label className="field">
                    Group name
                    <input
                      type="text"
                      key={item.id + item.name}
                      defaultValue={item.name}
                      maxLength={64}
                      onBlur={(event) =>
                        event.target.value.trim() &&
                        event.target.value.trim() !== item.name &&
                        work("rename-group", {
                          groupId: item.id,
                          name: event.target.value.trim(),
                        })
                      }
                    />
                  </label>
                  <strong>Where actionable work is tracked</strong>
                  <div className="rb-route">
                    {conditions.map(([condition, label]) => (
                      <label className="field" key={label}>
                        {label}
                        <select
                          value={
                            snapshot.routes.find(
                              (route) =>
                                route.groupId === item.id &&
                                route.condition === condition,
                            )?.tracker ?? ""
                          }
                          onChange={(event) =>
                            event.target.value &&
                            work("set-route", {
                              groupId: item.id,
                              condition,
                              tracker: event.target.value,
                            })
                          }
                        >
                          <option value="">
                            {condition
                              ? "Same as everything else"
                              : "Ask me when it matters"}
                          </option>
                          {trackers.map((tracker) => (
                            <option key={tracker} value={tracker}>
                              {tracker === "amun"
                                ? "Keep it in Amun"
                                : trackerName(tracker)}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <form
                className="row"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (group.trim()) work("add-group", { name: group.trim() });
                  setGroup("");
                }}
              >
                <input
                  type="text"
                  className="grow"
                  aria-label="New group name"
                  placeholder="Add a group"
                  value={group}
                  maxLength={64}
                  onChange={(event) => setGroup(event.target.value)}
                />
                <button className="btn" disabled={!group.trim()}>
                  Add group
                </button>
              </form>
            </section>
          )}
          {section === "permissions" && (
            <section aria-labelledby="rb-s-perm">
              <h2 id="rb-s-perm">Permissions</h2>
              <p className="muted">
                Firstmate works on its own inside what you have asked for, and
                asks when an action needs more.
              </p>
              <div>
                <h3>Always needs your approval</h3>
                {(Object.keys(gateLabels) as Gate[]).map((gate) => (
                  <div className="rb-gate" key={gate}>
                    <Icon name="warning" width={18} height={18} />
                    <span>{gateLabels[gate]}</span>
                  </div>
                ))}
                <p className="muted small">
                  No setting or standing permission can change these three.
                </p>
              </div>
              <div>
                <h3>Standing permissions</h3>
                {snapshot.permissions.filter((item) => !item.revokedAt)
                  .length ? (
                  <table>
                    <thead>
                      <tr>
                        <th>Group</th>
                        <th>Where</th>
                        <th>What</th>
                        <th>
                          <span className="sr-only">Revoke</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {snapshot.permissions
                        .filter((item) => !item.revokedAt)
                        .map((item) => (
                          <tr key={item.id}>
                            <td>{groupName(snapshot, item.groupId)}</td>
                            <td>{trackerName(item.destination)}</td>
                            <td>
                              {actions.find(
                                ([id]) => id === item.action,
                              )?.[1] ?? item.action}
                            </td>
                            <td>
                              <button
                                className="link"
                                onClick={() =>
                                  work("revoke-permission", {
                                    permissionId: item.id,
                                  })
                                }
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted">
                    None. Firstmate asks before each change outside a
                    conversation’s scope.
                  </p>
                )}
                <form
                  className="row wrap"
                  style={{ marginTop: 10 }}
                  onSubmit={(event) => {
                    event.preventDefault();
                    setProblem(
                      permission.destination === "ado"
                        ? `${gateLabels.ado_write} always needs your approval, so it cannot be a standing permission.`
                        : "",
                    );
                    if (permission.groupId && permission.destination !== "ado")
                      work("add-permission", permission);
                  }}
                >
                  <select
                    aria-label="Group"
                    required
                    value={permission.groupId}
                    onChange={(event) =>
                      setPermission({
                        ...permission,
                        groupId: event.target.value,
                      })
                    }
                  >
                    <option value="">Group…</option>
                    {snapshot.groups.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Where"
                    value={permission.destination}
                    onChange={(event) =>
                      setPermission({
                        ...permission,
                        destination: event.target.value,
                      })
                    }
                  >
                    {trackers.map((tracker) => (
                      <option key={tracker} value={tracker}>
                        {tracker === "amun" ? "Amun" : trackerName(tracker)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="What"
                    value={permission.permit}
                    onChange={(event) =>
                      setPermission({
                        ...permission,
                        permit: event.target.value,
                      })
                    }
                  >
                    {actions.map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <button className="btn" disabled={!permission.groupId}>
                    Allow
                  </button>
                </form>
                {problem && (
                  <p
                    className="small"
                    role="alert"
                    style={{
                      color: "var(--amun-status-signed-out)",
                      marginTop: 8,
                    }}
                  >
                    {problem}
                  </p>
                )}
              </div>
              <div>
                <h3>Information allowed across groups</h3>
                {snapshot.grants.filter((item) => !item.revokedAt).length ? (
                  snapshot.grants
                    .filter((item) => !item.revokedAt)
                    .map((item) => (
                      <div className="rb-line" key={item.id}>
                        <Icon name="link" width={18} height={18} />
                        <div>
                          <div>{item.information}</div>
                          <div className="muted small">
                            {groupName(snapshot, item.sourceGroupId)} to{" "}
                            {groupName(snapshot, item.targetGroupId)} ·{" "}
                            {item.purpose} · {shortDate(item.createdAt)}
                          </div>
                        </div>
                        <button
                          className="link"
                          onClick={() =>
                            work("revoke-grant", { grantId: item.id })
                          }
                        >
                          Revoke
                        </button>
                      </div>
                    ))
                ) : (
                  <p className="muted">Nothing is shared between groups.</p>
                )}
              </div>
              <div>
                <h3>Rules Firstmate has learned</h3>
                {snapshot.rules.filter((item) => item.state === "active")
                  .length ? (
                  snapshot.rules
                    .filter((item) => item.state === "active")
                    .map((item) => (
                      <div className="rb-line" key={item.id}>
                        <Icon name="check" width={18} height={18} />
                        <div>
                          <div>{item.resolution}</div>
                          <div className="muted small">
                            {groupName(snapshot, item.groupId)} ·{" "}
                            {item.situation} · learned from {item.examples}{" "}
                            cases · applied {item.uses} times
                          </div>
                        </div>
                        <button
                          className="link"
                          onClick={() =>
                            work("revoke-rule", { ruleId: item.id })
                          }
                        >
                          Revoke
                        </button>
                      </div>
                    ))
                ) : (
                  <p className="muted">
                    None yet. Firstmate proposes a rule once the same answer has
                    come up several times.
                  </p>
                )}
              </div>
            </section>
          )}
          {section === "council" && (
            <section aria-labelledby="rb-s-council">
              <h2 id="rb-s-council">Council</h2>
              <p className="muted">{simulationLabel}</p>
              <p>
                {councilStatus === null
                  ? "Checking…"
                  : councilStatus.installed
                    ? `Advisors installed · version ${councilStatus.commit?.slice(0, 7)}`
                    : "Advisors are not installed yet."}
              </p>
              {councilStatus?.message && (
                <p className="muted small">{councilStatus.message}</p>
              )}
              {councilStatus && !councilStatus.claude && (
                <p className="muted small">
                  Councils run on Claude Code, which was not found on this Mac.
                </p>
              )}
              {councilStatus?.seats.map((seat) => (
                <label className="row" key={seat.key}>
                  <input
                    type="checkbox"
                    checked={!seat.disabled}
                    onChange={(event) =>
                      council("toggle-seat", {
                        key: seat.key,
                        disabled: !event.target.checked,
                      })
                    }
                  />
                  {seat.name}
                  <span className="muted small">simulation</span>
                </label>
              ))}
              <div className="row wrap">
                <button
                  className="btn"
                  disabled={!councilStatus?.repo}
                  onClick={() => council("check-update")}
                >
                  Check for updates
                </button>
                <button
                  className="btn quiet"
                  disabled={!councilStatus?.previous}
                  onClick={() => council("rollback")}
                >
                  Go back to the previous version
                </button>
              </div>
              <p className="muted small">
                Updates are checked weekly, validated, and applied
                automatically; the previous version is kept.
              </p>
            </section>
          )}
          {section === "skills" && (
            <section aria-labelledby="rb-s-skills">
              <h2 id="rb-s-skills">Skills</h2>
              <p className="muted">
                Skills you install appear in the composer under /. Each one is
                reviewed before it is used.
              </p>
              {workspace?.productContext ? (
                <div className="legacy-surface">
                  <SkillsLibrary
                    key={workspace.productContext.productId}
                    context={workspace.productContext}
                  />
                </div>
              ) : (
                <p className="muted">
                  Open a product to add or review its skills.
                </p>
              )}
            </section>
          )}
          {section === "themes" && (
            <section aria-labelledby="rb-s-themes">
              <h2 id="rb-s-themes">Themes</h2>
              <div className="rb-cards">
                {(["system", ...themeIds] as const).map((id) => (
                  <button
                    key={id}
                    className="rb-card"
                    aria-pressed={snapshot.setup.theme === id}
                    onClick={() => work("setup", { patch: { theme: id } })}
                  >
                    {id !== "system" && (
                      <span
                        className="rb-swatch"
                        data-theme={id}
                        aria-hidden="true"
                      >
                        <i
                          style={{ background: "var(--amun-color-navigation)" }}
                        />
                        <i
                          style={{
                            background: "var(--amun-color-canvas)",
                            borderLeft: "3px solid var(--amun-color-accent)",
                          }}
                        />
                      </span>
                    )}
                    <strong>{themeNames[id]}</strong>
                    <span>
                      {id === "system"
                        ? "Light by day, dark by night"
                        : id === "amun-light"
                          ? "Light"
                          : "Dark"}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {section === "data" && (
            <section aria-labelledby="rb-s-data">
              <h2 id="rb-s-data">Data and backup</h2>
              <p className="muted">
                Your work is stored on this Mac. Encrypted backups leave
                sign-ins out.
              </p>
              <p>
                {snapshot.memory.unsynced
                  ? `${snapshot.memory.unsynced} remembered ${snapshot.memory.unsynced === 1 ? "fact is" : "facts are"} saved on this Mac and not yet in Notion.`
                  : "Nothing is waiting to be saved to Notion."}
                {snapshot.memory.disputed > 0 &&
                  ` ${snapshot.memory.disputed} ${snapshot.memory.disputed === 1 ? "is" : "are"} waiting for your answer.`}
              </p>
              <div className="legacy-surface">
                <BackupControls />
              </div>
            </section>
          )}
          {section === "advanced" && (
            <section aria-labelledby="rb-s-adv" style={{ maxWidth: "none" }}>
              <h2 id="rb-s-adv">Advanced</h2>
              <p className="muted">
                Runtime controls, sessions and diagnostics. Most people never
                need these.
              </p>
              <details>
                <summary className="link">Agent runtime and sessions</summary>
                <div className="legacy-surface" style={{ marginTop: 10 }}>
                  <AgentsPanel onOpenWorker={() => undefined} />
                </div>
              </details>
              <details>
                <summary className="link">
                  Firstmate conversation, commands and imports
                </summary>
                <div className="legacy-surface" style={{ marginTop: 10 }}>
                  <NativePiPanel />
                </div>
              </details>
              <p className="muted small">
                The earlier workspace remains available for comparison at Amun’s
                address with ?legacy=1.
              </p>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
