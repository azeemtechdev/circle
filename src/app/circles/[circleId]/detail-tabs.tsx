'use client';

import { useState } from 'react';

const TABS = [
  { id: 'members', label: 'Members' },
  { id: 'order', label: 'Order' },
  { id: 'rules', label: 'Rules' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** Members / Order / Rules. The panels are rendered on the server; this only switches. */
export function DetailTabs({ panels }: { panels: Record<TabId, React.ReactNode> }) {
  const [active, setActive] = useState<TabId>('members');

  return (
    <>
      <div className="segmented" role="tablist" aria-label="Circle details">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            onClick={() => setActive(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {panels[tab.id]}
        </div>
      ))}
    </>
  );
}
