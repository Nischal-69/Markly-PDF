interface LogoProps {
  size?: number;
  withWordmark?: boolean;
}

/**
 * Markly PDF logo: a simple document/bookmark "M" mark.
 * Single flat brand color — no gradients.
 */
export function Logo({ size = 28, withWordmark = true }: LogoProps) {
  return (
    <span className="markly-logo">
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="#0F6CBD" />
        <path
          d="M9 22.5v-11l7 5.2 7-5.2v11"
          fill="none"
          stroke="#fff"
          strokeWidth={2.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {withWordmark && (
        <span className="markly-wordmark">
          Markly&nbsp;PDF
        </span>
      )}
    </span>
  );
}
