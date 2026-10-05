'use client';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { ApiError, getAccessToken, refreshSession } from './api';

export const realtimeUrl =
  process.env.NEXT_PUBLIC_REALTIME_URL ??
  `${new URL(process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').origin}/realtime`;

export function useNotificationRealtime(userId?: string) {
  const client = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let stopped = false;
    let renewing = false;
    let connectedToken: string | null = null;
    const socket = io(realtimeUrl, {
      transports: ['websocket'],
      autoConnect: false,
      auth: (callback) => {
        connectedToken = getAccessToken();
        callback({ token: connectedToken });
      },
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });
    const refresh = () => client.invalidateQueries({ queryKey: ['notifications', userId] });
    async function renew() {
      if (stopped || renewing) return;
      renewing = true;
      try {
        if (getAccessToken() === connectedToken)
          client.setQueryData(['session'], await refreshSession());
        if (!stopped) socket.connect();
      } catch (error) {
        if (error instanceof ApiError && error.status === 401)
          void client.invalidateQueries({ queryKey: ['session'] });
      } finally {
        renewing = false;
      }
    }
    socket.on('connect', () => {
      void refresh();
    });
    socket.on('notification:changed', () => {
      void refresh();
    });
    socket.on('connect_error', (error) => {
      if (error.message === 'UNAUTHORIZED') void renew();
    });
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') void renew();
    });
    socket.on('session:expired', () => {
      socket.disconnect();
      void renew();
    });
    const recover = () => {
      if (!stopped && navigator.onLine) {
        socket.connect();
        void refresh();
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') recover();
    };
    const onOffline = () => socket.disconnect();
    const interval = setInterval(recover, 30000);
    window.addEventListener('online', recover);
    window.addEventListener('offline', onOffline);
    document.addEventListener('visibilitychange', onVisible);
    socket.connect();
    return () => {
      stopped = true;
      clearInterval(interval);
      window.removeEventListener('online', recover);
      window.removeEventListener('offline', onOffline);
      document.removeEventListener('visibilitychange', onVisible);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [client, userId]);
}
