import type { ZodType } from 'zod';
import { ApiErrorBody } from '@localchat/contracts';

/**
 * The single place the renderer talks to the local service.
 *
 * Two rules hold here and nowhere else:
 *  1. Every response is parsed through its schema. A backend that drifts from the contract
 *     fails at this boundary with a legible error, instead of rendering a half-empty answer
 *     to someone standing next to a running sorter.
 *  2. Only loopback is ever addressed. There is no configurable remote host.
 */

const DEFAULT_SERVICE_URL = 'http://127.0.0.1:8000';

/**
 * Where the local service lives.
 *
 * In live mode over http — the dev server, whether opened in a browser or inside the
 * Electron shell — this is the empty string, making every call same-origin so the Vite
 * proxy can forward it. The service installs no CORS middleware, so an absolute
 * `http://127.0.0.1:8000` from a page served on :5173 is refused by the browser before it
 * leaves. The packaged app loads from `app://`, has no dev server to proxy through, and
 * uses the address the main process resolved.
 */
export function serviceUrl(): string {
  const isDevServer = globalThis.location?.protocol?.startsWith('http') ?? false;
  if (__LIVE_SERVICE__ && isDevServer) return '';
  return globalThis.window?.localchat?.serviceUrl ?? DEFAULT_SERVICE_URL;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Network failures and 5xx are worth retrying; a 400 will fail the same way twice. */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }

  /** True when the local service is not answering at all — the "is it running?" case. */
  get serviceUnreachable(): boolean {
    return this.status === 0;
  }
}

/** Thrown when the service answered but not in the shape the contract promises. */
export class ContractViolationError extends Error {
  constructor(
    readonly path: string,
    readonly issues: string,
  ) {
    super(`The local service returned an unexpected shape from ${path}: ${issues}`);
    this.name = 'ContractViolationError';
  }
}

interface RequestOptions<TResponse> {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** A FormData body is sent as multipart and the JSON content type is left off. */
  body?: unknown;
  schema: ZodType<TResponse>;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | null | undefined>;
}

function withQuery(path: string, query: RequestOptions<unknown>['query']): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

export async function request<TResponse>(
  path: string,
  { method = 'GET', body, schema, signal, query }: RequestOptions<TResponse>,
): Promise<TResponse> {
  const url = `${serviceUrl()}${withQuery(path, query)}`;

  let response: Response;
  try {
    const multipart = body instanceof FormData;
    response = await fetch(url, {
      method,
      signal,
      // The browser must set its own boundary on a multipart body, so no header here.
      headers: body === undefined || multipart ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(
      0,
      'service_unreachable',
      'LocalChat cannot reach the local service. It may still be starting up.',
    );
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return schema.parse(undefined);
  }

  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ContractViolationError(
      path,
      parsed.error.issues
        .slice(0, 3)
        .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('; '),
    );
  }
  return parsed.data;
}

async function toApiError(response: Response): Promise<ApiError> {
  let code = 'unknown_error';
  let message = `The local service returned ${response.status}.`;
  let details: Record<string, unknown> | undefined;

  try {
    const parsed = ApiErrorBody.safeParse(await response.json());
    if (parsed.success) {
      code = parsed.data.code;
      message = parsed.data.message;
      details = parsed.data.details;
    }
  } catch {
    // A non-JSON error body is not worth failing over; the status carries enough.
  }

  return new ApiError(response.status, code, message, details);
}

/** Human-facing text for any error that reaches the UI. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof ContractViolationError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
