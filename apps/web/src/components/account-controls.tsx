'use client';
import { GlobalSearch } from './global-search';
import { NotificationBell } from './notification-bell';
import { ThemeToggle } from './theme-toggle';
export function AccountControls() {
  return (
    <div className="flex items-center gap-2">
      <GlobalSearch />
      <NotificationBell />
      <ThemeToggle />
    </div>
  );
}
