// Firstmate's face: the amber tile it has always had, with two eyes in place
// of the letter. The mood says what Firstmate is doing so it reads at a
// glance: resting, working, waiting for the owner, or finished.
export type FirstmateMood = "resting" | "working" | "needs" | "done";

export function FirstmateMark({
  size = 36,
  mood = "resting",
}: {
  size?: number;
  mood?: FirstmateMood;
}) {
  return (
    <span
      className="rb-fm-mark"
      data-mood={mood}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}
      aria-hidden="true"
    >
      <i />
      <i />
    </span>
  );
}
