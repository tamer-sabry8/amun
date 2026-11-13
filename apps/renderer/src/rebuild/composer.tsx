// Composer (Q27, Q70): `+` add things · `/` skills and commands · `@` agents
// and work areas. Routing is automatic and shown as a label. The mic only
// dictates into the box; nothing runs until the user sends.
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  builtInCommands,
  composerTrigger,
  dictation,
  matchCommands,
  matchMentions,
  plusMenu,
  routingLabel,
  type SlashCommand,
} from "../../../../packages/domain/src/work/shell.ts";
import { councilCommands } from "../../../../packages/domain/src/work/council.ts";
import { Icon } from "../icons.tsx";
import { ModelPicker } from "./model-picker.tsx";
import { takeOff } from "./motion.ts";

export const allCommands: SlashCommand[] = [
  ...builtInCommands,
  ...councilCommands.map((command) => ({ ...command })),
];

interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
const recognitionFactory = () => {
  const scope = globalThis as unknown as Record<string, new () => Recognition>;
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
};

export function Composer({
  placeholder = "Ask Firstmate…",
  chips = [],
  workAreas = [],
  model = null,
  busy = false,
  autoFocus = false,
  initial = "",
  onSend,
  onPlus,
  attached,
  onPick,
  onRemoveFile,
  pickNonce = 0,
}: {
  placeholder?: string;
  chips?: string[];
  agents?: { id: string; name: string }[];
  workAreas?: { id: string; name: string }[];
  model?: string | null;
  busy?: boolean;
  autoFocus?: boolean;
  /** Text to start with, e.g. from a suggestion card. */
  initial?: string;
  onSend(text: string, files: string[]): void;
  onPlus?(item: string): void;
  /** File names to show, when the parent keeps the attachments itself. */
  attached?: string[];
  /** Files just chosen. With this set, the parent reads and tracks them. */
  onPick?(files: File[]): void;
  onRemoveFile?(name: string): void;
  /** Changing this opens the file picker, e.g. for "Choose another file". */
  pickNonce?: number;
}) {
  const [draft, setDraft] = useState(initial);
  const [own, setFiles] = useState<string[]>([]);
  const files = attached ?? own;
  const [plus, setPlus] = useState(false);
  const [caret, setCaret] = useState(0);
  const [index, setIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const recognition = useRef<Recognition | null>(null);

  const trigger = dismissed ? null : composerTrigger(draft, caret);
  const options =
    trigger?.trigger === "/"
      ? matchCommands(allCommands, trigger.query).map((command) => ({
          key: command.name,
          label: "/" + command.name,
          hint: command.description,
          insert: "/" + command.name + " ",
        }))
      : trigger?.trigger === "@"
        ? // The owner talks to Firstmate only; it decides which agents help.
          // So "@" offers work areas, never agents.
          matchMentions(trigger.query, [], workAreas).map((mention) => ({
            key: mention.kind + mention.id,
            label: "@" + mention.name,
            hint: mention.kind === "agent" ? "Agent" : "Work area",
            insert: "@" + mention.name + " ",
          }))
        : [];
  const menuOpen = options.length > 0;
  useEffect(() => setIndex(0), [trigger?.trigger, trigger?.query]);
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = Math.min(element.scrollHeight, 200) + "px";
  }, [draft]);
  useEffect(() => () => recognition.current?.stop(), []);
  useEffect(() => {
    if (pickNonce) picker.current?.click();
  }, [pickNonce]);

  const change = (text: string, position = text.length) => {
    setDraft(text);
    setCaret(position);
    setDismissed(false);
  };
  const choose = (insert: string) => {
    if (!trigger) return;
    const start =
      trigger.trigger === "/" ? 0 : draft.slice(0, caret).lastIndexOf("@");
    const next = draft.slice(0, start) + insert + draft.slice(caret);
    change(next, start + insert.length);
    area.current?.focus();
  };
  const sendButton = useRef<HTMLButtonElement>(null);
  const send = () => {
    const text = draft.trim();
    if ((!text && !files.length) || busy) return;
    recognition.current?.stop();
    takeOff(sendButton.current?.firstElementChild);
    onSend(text, files);
    setDraft("");
    setFiles([]);
  };
  const keys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        setIndex(
          (value) =>
            (value + (event.key === "ArrowDown" ? 1 : options.length - 1)) %
            options.length,
        );
        return;
      }
      // A command already typed in full is sent, not completed again.
      const complete = draft.trim() === options[index]!.insert.trim();
      if ((event.key === "Enter" && !complete) || event.key === "Tab") {
        event.preventDefault();
        choose(options[index]!.insert);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      send();
    }
  };
  const mic = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Factory = recognitionFactory();
    if (!Factory) return;
    const session = new Factory();
    session.continuous = true;
    session.interimResults = false;
    session.lang = navigator.language;
    session.onresult = (event) => {
      const last =
        event.results[event.results.length - 1]?.[0]?.transcript ?? "";
      // Dictation lands in the box for review; it never sends by itself.
      setDraft((current) => dictation(current, last).draft);
    };
    session.onend = session.onerror = () => setListening(false);
    recognition.current = session;
    setListening(true);
    session.start();
  };

  return (
    <div className="rb-composer-wrap">
      {chips.length > 0 && (
        <div className="rb-chips">
          {chips.map((chip) => (
            <button
              key={chip}
              className="rb-chip"
              onClick={() => {
                change(chip);
                area.current?.focus();
              }}
            >
              {chip}
            </button>
          ))}
        </div>
      )}
      <div className="rb-composer">
        {menuOpen && (
          <div className="rb-menu" role="listbox" aria-label="Suggestions">
            {options.map((option, position) => (
              <button
                key={option.key}
                role="option"
                aria-selected={position === index}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option.insert);
                }}
              >
                {option.label}
                <span className="hint">{option.hint}</span>
              </button>
            ))}
          </div>
        )}
        {plus && (
          <div className="rb-menu" role="menu" aria-label="Add">
            {plusMenu.map(([id, label]) => (
              <button
                key={id}
                role="menuitem"
                onClick={() => {
                  setPlus(false);
                  if (id === "files") picker.current?.click();
                  else onPlus?.(id);
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="rb-files">
            {files.map((file) => (
              <span className="tag" key={file}>
                {file}
                <button
                  aria-label={`Remove ${file}`}
                  onClick={() =>
                    onRemoveFile
                      ? onRemoveFile(file)
                      : setFiles(files.filter((item) => item !== file))
                  }
                >
                  <Icon name="close" width={12} height={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <label className="sr-only" htmlFor="rb-composer-input">
          Message Firstmate
        </label>
        <textarea
          id="rb-composer-input"
          ref={area}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={draft}
          maxLength={16000}
          onChange={(event) =>
            change(event.target.value, event.target.selectionStart)
          }
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onKeyDown={keys}
          onBlur={() => setPlus(false)}
        />
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            if (onPick) {
              onPick(Array.from(event.target.files ?? []));
              event.target.value = "";
              return;
            }
            setFiles([
              ...new Set([
                ...files,
                ...Array.from(event.target.files ?? []).map(
                  (file) => file.name,
                ),
              ]),
            ]);
            event.target.value = "";
          }}
        />
        <div className="bar">
          <button
            className="icon-btn"
            aria-label="Add files, screenshots or sources"
            aria-expanded={plus}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setPlus(!plus)}
          >
            <Icon name="plus" width={18} height={18} />
          </button>
          <button
            className="icon-btn"
            aria-label="Skills and commands"
            onClick={() => {
              change("/");
              area.current?.focus();
            }}
          >
            <span aria-hidden="true">/</span>
          </button>
          <button
            className="icon-btn"
            aria-label="Mention a work area"
            onClick={() => {
              const next = draft + (draft && !draft.endsWith(" ") ? " @" : "@");
              change(next);
              area.current?.focus();
            }}
          >
            <span aria-hidden="true">@</span>
          </button>
          <ModelPicker label={routingLabel(model)} />
          {recognitionFactory() && (
            <button
              className="icon-btn rb-mic"
              aria-label={listening ? "Stop dictation" : "Dictate"}
              aria-pressed={listening}
              onClick={mic}
            >
              <Icon name="mic" width={18} height={18} />
            </button>
          )}
          <button
            className="rb-send"
            aria-label="Send"
            disabled={busy || (!draft.trim() && !files.length)}
            onClick={send}
            ref={sendButton}
          >
            <Icon name="up" width={16} height={16} strokeWidth={2.2} />
          </button>
        </div>
      </div>
    </div>
  );
}
