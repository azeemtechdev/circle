/**
 * Placeholders shown while a screen's data loads (via loading.tsx).
 *
 * Shaped like the real screen, so nothing jumps when it arrives — on slow 3G
 * this is what people look at for the first second or two.
 */

function Bar({ w, h = 14, style }: { w: string; h?: number; style?: React.CSSProperties }) {
  return <div className="skeleton" style={{ width: w, height: h, ...style }} />;
}

export function HeroSkeleton({ tall = false }: { tall?: boolean }) {
  return (
    <div className={`hero${tall ? ' hero--tall' : ''}`} aria-hidden="true">
      <div className="hero__bar">
        <div className="hero__who">
          <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />
          <Bar w="140px" />
        </div>
      </div>
      <Bar w="55%" />
      <Bar w="70%" h={40} style={{ margin: '12px 0' }} />
      <Bar w="45%" />
      <Bar w="100%" h={54} style={{ marginTop: 18, borderRadius: 16 }} />
    </div>
  );
}

export function CardSkeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="card" aria-hidden="true">
      <Bar w="50%" h={18} />
      {Array.from({ length: lines }, (_, i) => (
        <Bar key={i} w={i % 2 ? '60%' : '85%'} style={{ marginTop: 12 }} />
      ))}
    </div>
  );
}

export function ScreenLoading({ label, tall = false }: { label: string; tall?: boolean }) {
  return (
    <div role="status" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      <HeroSkeleton tall={tall} />
      <div style={{ height: 20 }} />
      <CardSkeleton />
      <CardSkeleton lines={3} />
    </div>
  );
}
