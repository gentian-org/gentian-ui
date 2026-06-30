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
      <path
        fill="currentColor"
        d="M4.5 3.5h7a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Zm0 1.5v7h7v-7h-7Z"
      />
    </svg>
  );
}

export function WindowRestoreIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6 2.5h6.5a1 1 0 0 1 1 1V6h-1.5V4.5H6V2.5ZM3.5 6H10a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Zm0 1.5v6.5H10V7.5H3.5Z"
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
