import {
  authSessionSchema,
  errorSchema,
  type ApiResponse,
  type AuthSession,
} from '@flowsync/contracts';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
let accessToken: string | null = null;
let pendingRefresh: Promise<AuthSession> | null = null;
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}
export function setAccessToken(token: string | null) {
  accessToken = token;
}
async function decodeEnvelope<T>(response: Response): Promise<ApiResponse<T>> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new ApiError(
      parsed.success ? parsed.data.message : 'Unable to complete this request',
      response.status,
      parsed.success ? parsed.data.code : 'REQUEST_FAILED',
    );
  }
  if (typeof body !== 'object' || body === null || !('data' in body))
    throw new ApiError('Unexpected server response', 502, 'INVALID_RESPONSE');
  return body as ApiResponse<T>;
}
async function decode<T>(response: Response): Promise<T> {
  return (await decodeEnvelope<T>(response)).data;
}
export async function refreshSession(): Promise<AuthSession> {
  if (!pendingRefresh) {
    pendingRefresh = fetch(`${API_URL}/auth/refresh`, { method: 'POST', credentials: 'include' })
      .then(decode<unknown>)
      .then((data) => {
        const session = authSessionSchema.parse(data);
        setAccessToken(session.accessToken);
        return session;
      })
      .finally(() => {
        pendingRefresh = null;
      });
  }
  return pendingRefresh;
}
export async function apiEnvelope<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    await refreshSession();
    return apiEnvelope<T>(path, options, false);
  }
  return decodeEnvelope<T>(response);
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await apiEnvelope<T>(path, options)).data;
}
