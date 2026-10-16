'use client';
import { useEffect, type Dispatch, type SetStateAction } from 'react';
export function useSearchShortcut(setOpen: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('dialog[open]')) return;
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [setOpen]);
}
