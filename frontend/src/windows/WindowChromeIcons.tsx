type IconProps = {
  className?: string;
};

export function WindowMinimizeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3 7.25h10a1.75 1.75 0 0 1 0 3.5H3a1.75 1.75 0 0 1 0-3.5Z"
      />
    </svg>
  );
}

export function WindowMaximizeIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="3.5"
        y="3.5"
        width="9"
        height="9"
        rx="0.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

export function WindowRestoreIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="5.5"
        y="2.5"
        width="7"
        height="7"
        rx="0.75"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <rect
        x="2.5"
        y="5.5"
        width="7"
        height="7"
        rx="0.75"
        fill="var(--gtn-paper-1, #ece8df)"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

export function WindowCloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
        d="M4.75 4.75l6.5 6.5M11.25 4.75l-6.5 6.5"
      />
    </svg>
  );
}
