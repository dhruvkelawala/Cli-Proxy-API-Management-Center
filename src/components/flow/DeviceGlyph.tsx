/** Laptop outline used for client sources in flow diagrams. */
export function DeviceGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="4" y="5" width="16" height="11" rx="1.8" />
      <path d="M2.5 19h19" />
    </svg>
  );
}
