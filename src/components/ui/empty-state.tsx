import { Icon, type IconName } from './icon';

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: IconName;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="dot" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <b>{title}</b>
      {children ? <p>{children}</p> : null}
    </div>
  );
}
