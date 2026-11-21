import { useEffect, useState } from "react";
import { backlogResult, type BacklogResult } from "@amun/contracts";
import { bridge } from "../bridge.ts";
import { browserStore, writeSource, writeBoard } from "../backlog-selection.ts";

export type ReviewBoard = { sourceId: string; team: string; level: string };
export function ReviewBacklogPicker({
  sources,
  productId,
  choose,
}: {
  sources: { id: string; title: string }[];
  productId: string;
  choose: (value: ReviewBoard) => void;
}) {
  const [sourceId, source] = useState(""),
    [team, setTeam] = useState(""),
    [level, setLevel] = useState("");
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([]),
    [levels, setLevels] = useState<{ id: string; name: string }[]>([]);
  const [preview, setPreview] = useState<Extract<
    BacklogResult,
    { view: "cards" }
  > | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    setPreview(null);
    setNotice("");
    if (!sourceId) return;
    const requestId = crypto.randomUUID(),
      action = level ? "cards" : team ? "options" : "teams";
    setNotice("Reading Azure…");
    const timer = setTimeout(
      () =>
        setNotice(
          "Azure did not answer. Choose the destination again to retry.",
        ),
      20000,
    );
    const stop = bridge.onEvent((event) => {
      const result = backlogResult.safeParse(event);
      if (
        !result.success ||
        result.data.productId !== productId ||
        result.data.requestId !== requestId
      )
        return;
      clearTimeout(timer);
      const r = result.data;
      setNotice("");
      if (r.view === "error") setNotice(r.message);
      if (r.view === "teams") {
        setTeams(r.teams);
        if (!r.teams.length) setNotice("No readable teams in this project.");
      }
      if (r.view === "options") {
        setLevels(r.levels);
        if (!r.levels.length) setNotice("No readable team backlogs.");
      }
      if (r.view === "cards") setPreview(r);
    });
    bridge.send({
      version: 1,
      kind: "backlog-read",
      productId,
      sourceId,
      requestId,
      action,
      ...(team ? { team } : {}),
      ...(level ? { level } : {}),
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, [productId, sourceId, team, level]);
  function select(makeDefault: boolean) {
    if (!preview || !sourceId || !team || !level) return;
    if (makeDefault) {
      writeBoard(browserStore(), productId, sourceId, { team, level });
      writeSource(browserStore(), productId, sourceId);
    }
    choose({ sourceId, team, level });
  }
  return (
    <details>
      <summary>Choose a comparison backlog</summary>
      <label className="field">
        Azure project
        <select
          value={sourceId}
          onChange={(e) => {
            source(e.target.value);
            setTeam("");
            setLevel("");
            setTeams([]);
            setLevels([]);
            setPreview(null);
          }}
        >
          <option value="">Choose project</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </label>
      {sourceId && (
        <label className="field">
          Team
          <select
            value={team}
            onChange={(e) => {
              setTeam(e.target.value);
              setLevel("");
              setLevels([]);
              setPreview(null);
            }}
          >
            <option value="">Choose team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {team && (
        <label className="field">
          Backlog
          <select
            value={level}
            onChange={(e) => {
              setLevel(e.target.value);
              setPreview(null);
            }}
          >
            <option value="">Choose backlog</option>
            {levels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {notice && <p role="status">{notice}</p>}
      {preview && (
        <>
          <p>{preview.cards.length} readable items</p>
          <ul>
            {preview.cards.slice(0, 3).map((c) => (
              <li key={c.id}>
                #{c.id} {c.title}
              </li>
            ))}
          </ul>
          <div className="row wrap">
            <button className="btn" onClick={() => select(false)}>
              Use for this review
            </button>
            <button className="btn quiet" onClick={() => select(true)}>
              Set as project default
            </button>
          </div>
        </>
      )}
    </details>
  );
}
