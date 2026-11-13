import type { SVGProps } from "react";
const paths: Record<string, string> = {
  browser: "M3 5h18v15H3z M3 9h18 M6 7h.01 M9 7h.01",
  terminal: "m5 6 5 6-5 6 M13 18h6",
  requests: "M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6 M9 20h6",
  agents:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M18 8a3 3 0 0 1 0 6 M22 21v-2a4 4 0 0 0-3-4",
  decisions: "M4 4h13v10H9l-4 4v-4H4z M11 18h5l4 3v-3h1V8",
  priorities: "M4 19h4v-5H4z M10 19h4V9h-4z M16 19h4V4h-4z",
  overview: "m3 10 9-7 9 7 M5 9v12h5v-7h4v7h5V9",
  prd: "M6 3h8l4 4v14H6z M14 3v5h5 M9 12h6 M9 16h6",
  backlog: "m12 3 10 5-10 5L2 8z M2 12l10 5 10-5 M2 16l10 5 10-5",
  sprint: "m13 2-9 12h7l-1 8 10-12h-7z",
  prs: "M6 3v12 M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6 M6 3a2 2 0 1 0 0 4 M14 5h1a3 3 0 0 1 3 3v7 M14 2l-3 3 3 3 M18 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6",
  artifacts: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M10 2h4l1 3 3 1 3 2v4l-3 2-1 3-3 3h-4l-2-3-3-1-3-2v-4l3-2 1-3z",
  activity: "M2 12h4l3-8 6 16 3-8h4",
  downloads: "M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5",
  skills: "m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1z",
  chevron: "m8 4 8 8-8 8",
  close: "m6 6 12 12 M18 6 6 18",
  send: "m3 3 18 9-18 9 4-9z M7 12h14",
  focus: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M9 9h6v6H9z",
  pin: "m9 3 6 0-1 6 4 4H6l4-4z M12 13v9",
  link: "M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2 M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2",
  check: "m4 12 5 5L20 6",
  home: "m3 11 9-8 9 8 M5 10v10h5v-6h4v6h5V10",
  council:
    "M12 3v18 M5 7h14 M5 7l-3 7a3 3 0 0 0 6 0z M19 7l-3 7a3 3 0 0 0 6 0z M8 21h8",
  roadmap: "M3 6h10 M3 12h16 M7 18h14 M13 6v0 M19 12v0",
  sprints: "m13 2-9 12h7l-1 8 10-12h-7z",
  portfolio: "M3 7h18v13H3z M8 7V4h8v3 M3 13h18",
  rfps: "M6 3h9l4 4v14H6z M15 3v5h4 M9 13h6 M9 17h3",
  library: "M4 4v16 M8 4v16 M12 4v16 M15 5l5 15",
  plus: "M12 5v14 M5 12h14",
  mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3 M5 11a7 7 0 0 0 14 0 M12 18v3",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  expand: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7",
  sidebar: "M3 4h18v16H3z M9 4v16",
  warning: "M12 3 2 20h20z M12 10v4 M12 17h.01",
  timer: "M12 8v5l3 2 M12 4a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M9 2h6",
  lead: "m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.3l6.1-.7z",
  copy: "M9 9h11v11H9z M5 15H4V4h11v1",
  up: "M12 19V5 M5 12l7-7 7 7",
  checking: "M12 3a9 9 0 1 0 9 9",
  grid: "M4 4h7v7H4z M13 4h7v7h-7z M4 13h7v7H4z M13 13h7v7h-7z",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
  external: "M14 4h6v6 M20 4l-9 9 M18 14v6H4V6h6",
};
export function Icon({
  name,
  ...props
}: { name: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] ?? paths.prd} />
    </svg>
  );
}
