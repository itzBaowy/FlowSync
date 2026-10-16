'use client';
import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardSchema, myTaskSchema } from '@flowsync/contracts';
import { api } from '@/lib/api';
import { paged } from '@/lib/organizations';
export function useDashboardWork() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search);
  const [due, setDue] = useState('all');
  const [priority, setPriority] = useState('');
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => dashboardSchema.parse(await api('/dashboard')),
    refetchInterval: 30000,
  });
  const tasks = useQuery({
    queryKey: ['my-tasks', term, due, priority, page],
    queryFn: () =>
      paged(
        `/me/tasks?page=${page}&limit=6&order=asc&search=${encodeURIComponent(term)}&due=${due}${priority ? `&priority=${priority}` : ''}`,
        myTaskSchema,
      ),
    refetchInterval: 30000,
  });
  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }
  function changeDue(value: string) {
    setDue(value);
    setPage(1);
  }
  function changePriority(value: string) {
    setPriority(value);
    setPage(1);
  }
  return {
    dashboard,
    tasks,
    page,
    setPage,
    search,
    changeSearch,
    due,
    changeDue,
    priority,
    changePriority,
  };
}
