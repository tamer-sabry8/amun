import { createRoot } from "react-dom/client";
import { useState } from "react";
import { attentionItem } from "@amun/contracts";
import { Island, attentionLabels } from "./island.tsx";
import type { IslandSize } from "./layout.ts";
const themes = ["tamer-sabry-default", "navy-gold", "navy-cyan"];
const sizes: IslandSize[] = ["rail", "pill", "card", "expanded"];
function Gallery() {
  const [theme, setTheme] = useState(themes[0]!);
  const [notice, setNotice] = useState(
    "Development fixtures; no actions are executed.",
  );
  return (
    <main className="gallery">
      <h1>Component gallery</h1>
      <label>
        Gallery theme
        <select
          value={theme}
          onChange={(event) => {
            setTheme(event.target.value);
            document.documentElement.dataset.theme = event.target.value;
          }}
        >
          {themes.map((theme) => (
            <option key={theme}>{theme}</option>
          ))}
        </select>
      </label>
      <p role="status">{notice}</p>
      <section className="control-gallery" data-testid="control-gallery">
        <h2>Controls and safety states</h2>
        <div className="button-row">
          <button className="primary">Primary action</button>
          <button>Secondary action</button>
          <button disabled>Unavailable action</button>
          <button className="safety-approval">Approve reviewed action</button>
          <button className="safety-destructive">Delete reviewed item</button>
        </div>
        <div className="button-row">
          {["idle", "working", "waiting", "failed"].map((tone) => (
            <button className={"status-pill tone-" + tone} key={tone}>
              <span className="status-dot" />
              {tone}
            </button>
          ))}
        </div>
        <label>
          Example input
          <input placeholder="Write a value" />
        </label>
        <label>
          Invalid example
          <input
            aria-invalid="true"
            defaultValue="Needs correction"
            aria-describedby="example-error"
          />
        </label>
        <p id="example-error">Enter a supported value.</p>
        <label>
          Example selection
          <select defaultValue="one">
            <option value="one">One</option>
            <option value="two">Two</option>
          </select>
        </label>
      </section>
      {themes.map((current) => (
        <div hidden={theme !== current} key={current}>
          {sizes.map((size) => (
            <section
              key={size}
              data-gallery-theme={current}
              data-gallery-size={size}
            >
              <h2>
                {current} · {size}
              </h2>
              <div className="gallery-cases">
                {[...Object.keys(attentionLabels), "empty"].map(
                  (type, index) => {
                    const item =
                      type === "empty"
                        ? null
                        : attentionItem.parse({
                            id: type,
                            productId: "gallery",
                            type,
                            origin: {
                              kind: [
                                "firstmate",
                                "secondmate",
                                "crewmate",
                                "amun",
                              ][index % 4],
                              label: [
                                "Firstmate",
                                "Secondmate · Research",
                                "Crewmate · Codex",
                                "Amun",
                              ][index % 4],
                              firstmateRef: null,
                            },
                            ask:
                              attentionLabels[
                                type as keyof typeof attentionLabels
                              ] + ": confirm the next step",
                            detail: "A bounded development request.",
                            blocking: [],
                            primaryAction: {
                              label:
                                type === "answer"
                                  ? "Answer question"
                                  : "Review request",
                              mode: type === "answer" ? "inline" : "navigate",
                              intent:
                                type === "answer" ? "answer" : "open_request",
                              targetRef: type,
                            },
                            governed: type === "approve",
                            state: "open",
                            snoozedUntil: null,
                            createdAt: "2026-11-06T00:00:00Z",
                          });
                    return (
                      <div key={type} data-gallery-case={type}>
                        <h3>{type}</h3>
                        <Island
                          items={item ? [item] : []}
                          size={size}
                          onSize={() => setNotice("Size control selected")}
                          onNavigate={() =>
                            setNotice(
                              "Navigation selected; request remains open",
                            )
                          }
                          onAnswer={() => setNotice("Answer selected")}
                          onSnooze={() => setNotice("Snooze selected")}
                        />
                      </div>
                    );
                  },
                )}
              </div>
            </section>
          ))}
        </div>
      ))}
    </main>
  );
}
export function startGallery() {
  document.body.classList.add("gallery-mode");
  document.documentElement.classList.add("gallery-mode");
  const root = document.getElementById("root");
  if (root) createRoot(root).render(<Gallery />);
}
