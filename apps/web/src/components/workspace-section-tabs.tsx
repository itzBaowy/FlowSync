'use client';
import { useId, type ReactNode } from 'react';
import { useSectionTabs } from '@/hooks/use-section-tabs';
interface WorkspaceSectionTabsProps {
  readonly label: string;
  readonly defaultTab: string;
  readonly sections: readonly {
    readonly id: string;
    readonly label: string;
    readonly content: ReactNode;
  }[];
}
export function WorkspaceSectionTabs({ label, defaultTab, sections }: WorkspaceSectionTabsProps) {
  const prefix = useId();
  const { active, setSelected, onKeyDown } = useSectionTabs(
    sections.map((section) => section.id),
    defaultTab,
  );
  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="mb-5 flex gap-1 overflow-x-auto border-b border-border"
      >
        {sections.map((section, index) => (
          <button
            key={section.id}
            id={`${prefix}-${section.id}`}
            type="button"
            role="tab"
            aria-selected={active === section.id}
            aria-controls={`${prefix}-${section.id}-panel`}
            tabIndex={active === section.id ? 0 : -1}
            onClick={() => setSelected(section.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={`min-h-11 shrink-0 border-b-2 px-4 text-xs font-medium transition-colors ${active === section.id ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {section.label}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <div
          key={section.id}
          id={`${prefix}-${section.id}-panel`}
          role="tabpanel"
          aria-labelledby={`${prefix}-${section.id}`}
          hidden={active !== section.id}
          tabIndex={0}
          className="outline-none focus-visible:rounded-xl focus-visible:outline-2 focus-visible:outline-primary"
        >
          {section.content}
        </div>
      ))}
    </div>
  );
}
