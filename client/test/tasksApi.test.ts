import { describe, it, expect, vi, afterEach } from 'vitest';
import { listTasks, createTask, toggleTask, deleteTask, ApiError } from '../src/api/tasksApi';

const TASK = {
  id: '9c8f6b3e-1a2d-4c5f-8e7a-0b1c2d3e4f5a',
  title: 'Buy milk',
  description: null,
  completed: false,
  createdAt: '2026-09-07T10:00:00.000Z',
  updatedAt: '2026-09-07T10:00:00.000Z',
};

function stubFetch(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200;
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('tasksApi', () => {
  it('listTasks GETs /api/tasks', async () => {
    const fetchMock = stubFetch([TASK]);
    await expect(listTasks()).resolves.toEqual([TASK]);
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'GET' }));
  });

  it('createTask POSTs a JSON body', async () => {
    const fetchMock = stubFetch(TASK, { status: 201 });
    await expect(createTask({ title: 'Buy milk' })).resolves.toEqual(TASK);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tasks');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ title: 'Buy milk' });
  });

  it('toggleTask PATCHes the toggle path with no body', async () => {
    const fetchMock = stubFetch({ ...TASK, completed: true });
    await expect(toggleTask(TASK.id)).resolves.toMatchObject({ completed: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`/api/tasks/${TASK.id}/toggle`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBeUndefined();
  });

  it('deleteTask DELETEs and resolves with nothing on 204', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => { throw new Error('no body'); } });
    vi.stubGlobal('fetch', fetchMock);

    // A 204 has no body — parsing it as JSON would throw.
    await expect(deleteTask(TASK.id)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(`/api/tasks/${TASK.id}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('unwraps the error envelope into a typed ApiError', async () => {
    stubFetch(
      { error: { code: 'VALIDATION_ERROR', message: 'title must be 1-200 characters', details: [{ path: 'title', message: 'Too small' }] } },
      { status: 400 },
    );

    await expect(createTask({ title: '' })).rejects.toBeInstanceOf(ApiError);
    await expect(createTask({ title: '' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'title must be 1-200 characters',
    });
  });

  it('falls back to a generic message when json() throws (HTML proxy response)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => { throw new SyntaxError('Unexpected token < in JSON at position 0'); },
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listTasks()).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('falls back to a generic message when the body is not an envelope object', async () => {
    stubFetch('<html>502 Bad Gateway</html>', { status: 502 });
    await expect(listTasks()).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('falls back when error envelope is missing the code field', async () => {
    stubFetch(
      { error: { message: 'something went wrong' } },
      { status: 500 },
    );

    await expect(listTasks()).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
  });
});
