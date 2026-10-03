import type { SVGProps } from "react";

export type IconName =
  | "home"
  | "recent"
  | "note"
  | "bookmark"
  | "open"
  | "chevronLeft"
  | "chevronRight"
  | "minus"
  | "plus"
  | "fitWidth"
  | "fitPage"
  | "fullscreen"
  | "fullscreenExit"
  | "save"
  | "panel"
  | "close"
  | "file"
  | "alert"
  | "trash"
  | "check";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M2.5 7.2 8 2.5l5.5 4.7V13.5a.5.5 0 0 1-.5.5H9.5v-4h-3v4H3a.5.5 0 0 1-.5-.5V7.2Z" />,
  recent: (
    <>
      <circle cx="8" cy="8" r="5.7" />
      <path d="M8 5v3.2l2.2 1.3" />
    </>
  ),
  note: <path d="M11.5 2.8a1.4 1.4 0 0 1 2 0l.2.2a1.4 1.4 0 0 1 0 2L5.4 13.3l-2.9.7.7-2.9 8.3-8.3Z" />,
  bookmark: <path d="M4.5 2.5h7a.5.5 0 0 1 .5.5v10.5L8 10.8l-4 2.7V3a.5.5 0 0 1 .5-.5Z" />,
  open: (
    <>
      <path d="M2.5 5.5A1 1 0 0 1 3.5 4.5h3l1.2 1.5h4.8a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V5.5Z" />
    </>
  ),
  chevronLeft: <path d="M9.8 3.5 5.3 8l4.5 4.5" />,
  chevronRight: <path d="M6.2 3.5 10.7 8l-4.5 4.5" />,
  minus: <path d="M3.5 8h9" />,
  plus: <path d="M8 3.5v9M3.5 8h9" />,
  fitWidth: <path d="M2.5 5.5v-3h3M13.5 2.5h-3M13.5 13.5v-3M10.5 13.5h3M2.5 8h11" />,
  fitPage: (
    <>
      <path d="M5.8 2.5H3.5a1 1 0 0 0-1 1v2.3M10.2 2.5h2.3a1 1 0 0 1 1 1v2.3M13.5 10.2v2.3a1 1 0 0 1-1 1h-2.3M2.5 10.2v2.3a1 1 0 0 0 1 1h2.3" />
      <rect x="6" y="4.8" width="4" height="6.4" rx="0.6" />
    </>
  ),
  fullscreen: <path d="M5.8 2.5H3.5a1 1 0 0 0-1 1v2.3M10.2 2.5h2.3a1 1 0 0 1 1 1v2.3M13.5 10.2v2.3a1 1 0 0 1-1 1h-2.3M2.5 10.2v2.3a1 1 0 0 0 1 1h2.3" />,
  fullscreenExit: <path d="M5.8 5.8H2.5V2.5M10.2 5.8h3.3V2.5M13.5 10.2v3.3h-3.3M2.5 10.2v3.3h3.3" />,
  save: (
    <>
      <path d="M3 3h8l2 2v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
      <path d="M5 3v3.5h5V3M5.5 13.5v-4h5v4" />
    </>
  ),
  panel: <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  file: (
    <>
      <path d="M4 1.8h5.2L12.5 5v9.2a.3.3 0 0 1-.3.3H4a.3.3 0 0 1-.3-.3V2.1a.3.3 0 0 1 .3-.3Z" />
      <path d="M9 2v3.2h3.3" />
    </>
  ),
  alert: (
    <>
      <path d="M8 2.2 14.5 13.5h-13L8 2.2Z" />
      <path d="M8 6.5v3.2" />
      <circle cx="8" cy="11.6" r=".4" fill="currentColor" stroke="none" />
    </>
  ),
  trash: <path d="M2.8 4h10.4M6.5 4V2.8a.3.3 0 0 1 .3-.3h2.4a.3.3 0 0 1 .3.3V4M4 4l.7 9a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L12 4M6.6 7v4M9.4 7v4" />,
  check: <path d="M3 8.5 6.5 12 13 4.5" />,
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

/** Clean 16px stroke icons (currentColor). No emoji, no images. */
export function Icon({ name, size = 16, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
