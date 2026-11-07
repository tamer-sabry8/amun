import { useEffect, useRef, useState } from "react";
export function DraftEditor({
  initial,
  apply,
  close,
}: {
  initial: string;
  apply: (text: string) => void;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(initial);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog ref={dialog} aria-label="Edit conversation draft" onCancel={close}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          apply(value);
          close();
        }}
      >
        <label>
          Draft text
          <textarea
            autoFocus
            rows={16}
            cols={64}
            maxLength={12000}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <button type="submit">Apply draft</button>
        <button type="button" onClick={close}>
          Cancel
        </button>
      </form>
    </dialog>
  );
}
