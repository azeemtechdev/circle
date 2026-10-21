import type { ActivityItem } from '@/lib/circles/activity';

import { Icon } from './icon';
import { dotClass } from './status';
import { TimeAgo } from './time-ago';

export function ActivityRow({ item }: { item: ActivityItem }) {
  const icon = item.tone === 'ok' ? 'check' : item.tone === 'wait' ? 'clock' : item.tone === 'bad' ? 'bell' : 'users';
  return (
    <div className="row">
      <span className={dotClass(item.tone)} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="row__main">
        {item.text}
        <small>
          {item.circleName} · <TimeAgo iso={item.at} />
        </small>
      </span>
    </div>
  );
}
