export interface RequestOptions extends RequestInit {
  json?: unknown;
}

export interface ManagementRequestOptions extends RequestOptions {
  onUnauthorized?: () => void;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function withJson(init: RequestOptions): RequestInit {
  const { json, headers: initialHeaders, ...requestInit } = init;
  const headers = new Headers(initialHeaders);
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  return { ...requestInit, headers, ...(json === undefined ? {} : { body: JSON.stringify(json) }) };
}

/** Management requests always use the short-lived bearer token and bypass caches. */
export async function managementRequest(
  url: string,
  token: string,
  init: ManagementRequestOptions = {},
): Promise<Response> {
  const { onUnauthorized, ...requestInit } = init;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(url, withJson({ ...requestInit, headers, cache: 'no-store' }));
  if (response.status === 401) onUnauthorized?.();
  return response;
}

/** Scoring is a separate trust boundary and authenticates only with its cookie session. */
export function scoringRequest(url: string, init: RequestOptions = {}): Promise<Response> {
  return fetch(url, withJson({ ...init, credentials: 'same-origin', cache: 'no-store' }));
}

export async function decodeJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new HttpError(response.status, `Expected a JSON response (HTTP ${response.status})`);
  }
}

/** Decodes successful JSON and retains status/body details for endpoint-specific error messages. */
export async function requireJson<T>(response: Response): Promise<T> {
  let body: unknown;
  try {
    body = (await response.json()) as unknown;
  } catch {
    if (!response.ok) throw new HttpError(response.status, `Request failed (HTTP ${response.status})`);
    throw new HttpError(response.status, `Expected a JSON response (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const message =
      typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
        ? body.message
        : `Request failed (HTTP ${response.status})`;
    throw new HttpError(response.status, message, body);
  }
  return body as T;
}
