import { CardSkeleton } from '@/components/ui/skeletons';

export default function Loading() {
  return (
    <div role="status" aria-busy="true">
      <span className="visually-hidden">Loading activity</span>
      <div className="page-head">
        <h1>Activity</h1>
        <p className="mute">Every payment and confirmation, newest first.</p>
      </div>
      <CardSkeleton lines={4} />
      <CardSkeleton lines={4} />
    </div>
  );
}
