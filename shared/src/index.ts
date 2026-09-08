/** A task as it appears on the wire. Dates are ISO 8601 strings, not Date objects. */
export interface TaskDto {
  id: string;
  title: string;
  description: string | null;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Request body accepted by POST /api/tasks. */
export interface CreateTaskInput {
  title: string;
  description?: string | null;
}

export type ApiErrorCode = 'VALIDATION_ERROR' | 'NOT_FOUND' | 'INTERNAL_ERROR';

export interface ApiErrorDetail {
  path: string;
  message: string;
}

/** Every error response from the API has exactly this shape. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetail[];
  };
}
