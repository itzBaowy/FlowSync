'use client';
import { useState, type KeyboardEvent } from 'react';
export function useSectionTabs(ids: readonly string[], defaultTab: string) {
  const [selected, setSelected] = useState(defaultTab);
  const active = ids.includes(selected) ? selected : ids[0];
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!offset && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? ids.length - 1
          : (index + offset + ids.length) % ids.length;
    setSelected(ids[next]!);
    const buttons =
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons?.[next]?.focus();
  }
  return { active, setSelected, onKeyDown };
}
