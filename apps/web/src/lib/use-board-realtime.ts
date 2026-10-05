'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { boardChangedSchema, boardJoinedSchema, type BoardSnapshot } from '@flowsync/contracts';
import { ApiError, getAccessToken, refreshSession } from './api';
import { kanbanKeys } from './kanban';
type Status = 'connecting' | 'live' | 'offline' | 'revoked';
const url =
  process.env.NEXT_PUBLIC_REALTIME_URL ??
  `${new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').origin}/realtime`;
export function useBoardRealtime(boardId: string) {
  const client = useQueryClient();
  const [status, setStatus] = useState<Status>('connecting');
  useEffect(() => {
    let stopped = false;
    let renewing = false;
    let connectedToken: string | null = null;
    const socket = io(url, {
      transports: ['websocket'],
      autoConnect: false,
      auth: (callback) => {
        connectedToken = getAccessToken();
        callback({ token: connectedToken });
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    const refresh = () =>
      Promise.all(
        [...kanbanKeys, 'project'].map((key) => client.invalidateQueries({ queryKey: [key] })),
      );
    async function renew() {
      if (stopped || renewing) return;
      renewing = true;
      try {
        if (getAccessToken() === connectedToken) {
          const session = await refreshSession();
          client.setQueryData(['session'], session);
        }
        if (!stopped) socket.connect();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          void client.invalidateQueries({ queryKey: ['session'] });
      } finally {
        renewing = false;
      }
    }
    socket.on('connect', async () => {
      try {
        const reply = boardJoinedSchema.parse(
          await socket.timeout(5000).emitWithAck('board:join', { boardId }),
        );
        if (stopped) return;
        if (reply.ok) {
          setStatus('live');
          await refresh();
        } else if (reply.code === 'NOT_FOUND') {
          setStatus('revoked');
          socket.disconnect();
          await refresh();
        } else setStatus('offline');
      } catch {
        if (!stopped) setStatus('offline');
      }
    });
    socket.on('disconnect', (reason) => {
      if (stopped) return;
      setStatus((current) => (current === 'revoked' ? current : 'offline'));
      if (reason === 'io server disconnect') void renew();
    });
    socket.on('connect_error', (error) => {
      if (!stopped) {
        setStatus('offline');
        if (error.message === 'UNAUTHORIZED') void renew();
      }
    });
    socket.on('session:expired', () => {
      socket.disconnect();
      void renew();
    });
    socket.on('board:revoked', (event: unknown) => {
      if (typeof event !== 'object' || !event || !('boardId' in event) || event.boardId !== boardId)
        return;
      setStatus('revoked');
      socket.disconnect();
      void refresh();
    });
    socket.on('board:changed', (input: unknown) => {
      const event = boardChangedSchema.safeParse(input);
      if (!event.success || event.data.boardId !== boardId) return;
      const snapshot = client.getQueryData<BoardSnapshot>(['board', boardId]);
      if (!event.data.deleted && snapshot && event.data.revision <= snapshot.revision) return;
      void refresh();
    });
    const recover = () => {
      if (!stopped) void refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') recover();
    };
    const onOffline = () => {
      socket.disconnect();
      setStatus('offline');
    };
    const onOnline = () => {
      socket.connect();
      recover();
    };
    // Redis fanout is best effort: recover missed last events even without a later revision gap.
    const interval = setInterval(recover, 30000);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    socket.connect();
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [boardId, client]);
  return status;
}
