export type FsIconName = "shield" | "search" | "folder" | "home" | "arrow" | "check" | "bell" | "user" | "document";

const PATHS: Record<FsIconName, React.ReactNode> = {
  shield: <><path d="m12 3 8 3v6c0 4-3.3 7-8 9-4.7-2-8-5-8-9V6l8-3Z" /><path d="m8.5 12 2.3 2.3 4.7-5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
  folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />,
  home: <path d="m3 10 9-7 9 7M5 9v11h5v-6h4v6h5V9" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
  user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  document: <path d="M14 3H5v18h14V8l-5-5Zm0 0v5h5M8 12h8M8 16h5" />,
};

export function FsIcon({ name, className = "" }: { name: FsIconName; className?: string }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`fs-icon ${className}`}>{PATHS[name]}</svg>;
}
