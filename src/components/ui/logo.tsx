/** The Circle mark: an open ring with the lime "your turn" dot. */
export function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle
        cx="16"
        cy="16"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        strokeDasharray="58 11.1"
        transform="rotate(-62 16 16)"
      />
      <circle cx="25.2" cy="6.9" r="3.6" fill="#BDF26D" />
    </svg>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <span className="logo">
      <Mark size={size} />
      Circle
    </span>
  );
}
