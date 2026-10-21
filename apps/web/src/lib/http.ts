export interface RequestOptions extends RequestInit {
  json?: unknown;
}

function withJson(init: RequestOptions): RequestInit {
  const { json, headers: initialHeaders, ...requestInit } = init;
  const headers = new Headers(initialHeaders);
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  return { ...requestInit, headers, ...(json === undefined ? {} : { body: JSON.stringify(json) }) };
}

/** Management requests always use the short-lived bearer token and bypass caches. */
export function managementRequest(url: string, token: string, init: RequestOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return fetch(url, withJson({ ...init, headers, cache: 'no-store' }));
}

/** Scoring is a separate trust boundary and authenticates only with its cookie session. */
export function scoringRequest(url: string, init: RequestOptions = {}): Promise<Response> {
  return fetch(url, withJson({ ...init, credentials: 'same-origin', cache: 'no-store' }));
}

export async function decodeJson<T>(response: Response): Promise<T> {
  return await response.json() as T;
}
