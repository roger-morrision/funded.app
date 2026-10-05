export function createApiError(code, message, extra = {}) {
  return {
    ok: false,
    error: {
      code,
      message,
      ...extra,
    },
  };
}

export function createApiSuccess(data, meta = {}) {
  return {
    ok: true,
    data,
    meta,
  };
}

export function assertValidRequest(payload, schema) {
  if (!schema || typeof schema !== 'function') {
    return payload;
  }

  const result = schema(payload);
  if (result && result.valid === false) {
    throw new Error(result.message || 'Request validation failed.');
  }

  return payload;
}

export function normalizeError(error) {
  const message = error?.message || 'Unexpected error';
  return {
    ok: false,
    error: {
      code: 'UNKNOWN_ERROR',
      message,
      stack: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    },
  };
}

export function withApiEnvelope(handler) {
  return async function wrappedRequest(...args) {
    try {
      const result = await handler(...args);
      return result && result.ok !== undefined ? result : createApiSuccess(result);
    } catch (error) {
      return normalizeError(error);
    }
  };
}
