export async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function createApiClient(baseUrl = '') {
  return {
    get: (path, init = {}) => fetchJson(`${baseUrl}${path}`, { ...init, method: 'GET' }),
    post: (path, body, init = {}) => fetchJson(`${baseUrl}${path}`, {
      ...init,
      method: 'POST',
      body: JSON.stringify(body),
    }),
  };
}
