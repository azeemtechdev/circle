/**
 * Initials in a coloured disc. The colour is derived from the name so the same
 * person looks the same on every screen, without storing anything.
 */

function initial(name: string | null): string {
  const trimmed = (name ?? '').trim();
  return trimmed ? trimmed[0]!.toUpperCase() : '?';
}

function tone(name: string | null): number {
  const text = name ?? '';
  let sum = 0;
  for (const char of text) sum += char.codePointAt(0) ?? 0;
  return sum % 6;
}

export function Avatar({ name, large = false }: { name: string | null; large?: boolean }) {
  return (
    <span className={`avatar avatar--${tone(name)}${large ? ' avatar--lg' : ''}`} aria-hidden="true">
      {initial(name)}
    </span>
  );
}

/** Up to `max` faces, overlapping. Purely decorative — names are in the text. */
export function AvatarStack({ names, max = 6 }: { names: (string | null)[]; max?: number }) {
  return (
    <span className="avatar-stack" aria-hidden="true">
      {names.slice(0, max).map((name, index) => (
        <Avatar key={index} name={name} />
      ))}
    </span>
  );
}
