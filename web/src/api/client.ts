const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getToken(): string | null {
  return localStorage.getItem('sycamore_token');
}

interface ErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    // Only set when there is a body: the API's JSON body parser rejects a
    // request whose content-type claims JSON but whose body is empty (e.g.
    // POST /review/flags/:id/resolve, which takes no payload).
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  if (response.status === 401) {
    localStorage.removeItem('sycamore_token');
    localStorage.removeItem('sycamore_user');
    window.dispatchEvent(new Event('sycamore:unauthorized'));
  }

  const body = (await response.json().catch(() => null)) as T & ErrorBody;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      body?.error?.code ?? 'UNKNOWN_ERROR',
      body?.error?.message ?? 'Something went wrong',
      body?.error?.details,
    );
  }

  return body;
}
