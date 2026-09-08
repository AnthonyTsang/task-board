import type {
  TaskDto, CreateTaskInput, ApiErrorBody, ApiErrorCode, ApiErrorDetail,
} from '@taskboard/shared';

/** A failed API call, with the server's error envelope unwrapped. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: ApiErrorDetail[];

  constructor(status: number, code: ApiErrorCode, message: string, details?: ApiErrorDetail[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const validErrorCodes: readonly ApiErrorCode[] = ['VALIDATION_ERROR', 'NOT_FOUND', 'INTERNAL_ERROR'];

function isErrorBody(value: unknown): value is ApiErrorBody {
  return (
    typeof value === 'object' && value !== null && 'error' in value &&
    typeof (value as ApiErrorBody).error?.message === 'string' &&
    validErrorCodes.includes((value as ApiErrorBody).error?.code as ApiErrorCode)
  );
}

/**
 * The only place in the client that knows about HTTP. Components and hooks
 * receive either data or an ApiError — never a Response.
 */
async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    // fetch() rejects (a TypeError, e.g. "Failed to fetch") when the network
    // request never produces an HTTP response at all — the API is unreachable,
    // DNS failed, CORS blocked it, etc. Every caller's declared error type is
    // ApiError, so that rejection must not leak past this boundary raw.
    // status: 0 signals "no HTTP response was received," distinct from any
    // real status code.
    throw new ApiError(0, 'INTERNAL_ERROR', 'Unable to reach the server. Check your connection and try again.');
  }

  if (!response.ok) {
    let body: unknown;
    try { body = await response.json(); } catch { body = null; }

    if (isErrorBody(body)) {
      throw new ApiError(response.status, body.error.code, body.error.message, body.error.details);
    }
    throw new ApiError(response.status, 'INTERNAL_ERROR', `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export function listTasks(): Promise<TaskDto[]> {
  return request<TaskDto[]>('/api/tasks', { method: 'GET' });
}

export function createTask(input: CreateTaskInput): Promise<TaskDto> {
  return request<TaskDto>('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

/** Flips `completed`. Sends no body — the endpoint toggles, it does not set. */
export function toggleTask(id: string): Promise<TaskDto> {
  return request<TaskDto>(`/api/tasks/${id}/toggle`, { method: 'PATCH' });
}

export function deleteTask(id: string): Promise<void> {
  return request<void>(`/api/tasks/${id}`, { method: 'DELETE' });
}
