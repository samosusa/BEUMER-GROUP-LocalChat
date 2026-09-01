import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { ApiError, ContractViolationError, request } from './http';

/**
 * The transport boundary. These tests exist because the failure this layer prevents —
 * a backend that quietly changes shape — is invisible until it renders a wrong answer.
 */

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const Schema = z.object({ status: z.literal('ok'), count: z.number() });

describe('request', () => {
  it('returns parsed data when the response matches the contract', async () => {
    server.use(http.get('*/thing', () => HttpResponse.json({ status: 'ok', count: 3 })));
    await expect(request('/thing', { schema: Schema })).resolves.toEqual({
      status: 'ok',
      count: 3,
    });
  });

  it('rejects a response that drifts from the contract, naming the field', async () => {
    server.use(http.get('*/thing', () => HttpResponse.json({ status: 'ok', count: '3' })));

    await expect(request('/thing', { schema: Schema })).rejects.toBeInstanceOf(
      ContractViolationError,
    );
    await expect(request('/thing', { schema: Schema })).rejects.toThrow(/count/);
  });

  it('surfaces the service error message rather than a bare status code', async () => {
    server.use(
      http.get('*/thing', () =>
        HttpResponse.json(
          { code: 'index_locked', message: 'The index is being rebuilt.' },
          { status: 409 },
        ),
      ),
    );

    await expect(request('/thing', { schema: Schema })).rejects.toMatchObject({
      status: 409,
      code: 'index_locked',
      message: 'The index is being rebuilt.',
    });
  });

  it('reports an unreachable service as its own condition, not a generic failure', async () => {
    server.use(http.get('*/thing', () => HttpResponse.error()));

    const error = await request('/thing', { schema: Schema }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).serviceUnreachable).toBe(true);
    expect((error as ApiError).retryable).toBe(true);
  });

  it('does not retry a client error', async () => {
    server.use(
      http.get('*/thing', () =>
        HttpResponse.json({ code: 'bad', message: 'nope' }, { status: 400 }),
      ),
    );

    const error = await request('/thing', { schema: Schema }).catch((cause: unknown) => cause);
    expect((error as ApiError).retryable).toBe(false);
  });

  it('drops empty query parameters instead of sending projectId=', async () => {
    let seen = '';
    server.use(
      http.get('*/thing', ({ request: incoming }) => {
        seen = new URL(incoming.url).search;
        return HttpResponse.json({ status: 'ok', count: 0 });
      }),
    );

    await request('/thing', { schema: Schema, query: { projectId: null, query: '', limit: 5 } });
    expect(seen).toBe('?limit=5');
  });
});
