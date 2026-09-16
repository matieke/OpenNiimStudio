export class ApiRequestError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ApiRequestError';
    Object.assign(this, details);
  }
}

const detailText = (value) => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => item?.msg || item?.message || detailText(item))
      .filter(Boolean)
      .join('; ');
  }
  if (value && typeof value === 'object') {
    return value.message || value.error || JSON.stringify(value);
  }
  return '';
};

export const apiErrorFromResponse = async (response, fallback = 'Request failed') => {
  let payload = null;
  let responseText = '';

  try {
    responseText = await response.text();
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {
    // Plain-text and empty error responses are valid failure modes.
  }

  const detail = payload?.detail ?? payload;
  const structured = detail && typeof detail === 'object' && !Array.isArray(detail)
    ? detail
    : {};
  const message = structured.message
    || detailText(detail)
    || responseText.trim()
    || `${fallback} (HTTP ${response.status})`;

  return new ApiRequestError(message, {
    status: response.status,
    stage: structured.stage,
    technicalDetail: structured.error,
    suggestion: structured.suggestion,
    errorId: structured.error_id,
  });
};

export const checkServerHealth = async () => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch('/api/health', {
      cache: 'no-store',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
};

const isNetworkFetchError = (error) => (
  error instanceof TypeError
  || /failed to fetch|networkerror|network request failed|load failed/i.test(error?.message || '')
);

export const describePrintError = async (error, healthCheck = checkServerHealth) => {
  if (error instanceof ApiRequestError) {
    const lines = [error.message];
    if (error.technicalDetail && error.technicalDetail !== error.message) {
      lines.push(`Technical detail: ${error.technicalDetail}`);
    }
    if (error.suggestion) lines.push(`Try: ${error.suggestion}`);

    const reference = [
      error.stage ? `stage: ${error.stage}` : null,
      error.status ? `HTTP ${error.status}` : null,
      error.errorId ? `reference: ${error.errorId}` : null,
    ].filter(Boolean).join(', ');
    if (reference) lines.push(`Diagnostic: ${reference}`);
    return lines.join('\n\n');
  }

  if (isNetworkFetchError(error)) {
    const serverIsRunning = await healthCheck();
    if (!serverIsRunning) {
      return [
        'The OpenNiimStudio server stopped responding while the print request was running.',
        'Reopen OpenNiimStudio and check the terminal/server logs for the underlying Python or Bluetooth error. Then turn the printer off and on, scan again, and retry.',
      ].join('\n\n');
    }
    return [
      'The browser lost the print request, although the OpenNiimStudio server is responding again.',
      'Check the terminal/server logs for the underlying Bluetooth error, then scan for the printer again and retry.',
      `Browser detail: ${error?.message || 'Network request failed'}`,
    ].join('\n\n');
  }

  return error?.message || 'An unknown print error occurred.';
};
