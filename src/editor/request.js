/**
 * Keep the editor's HTTP boundary in one place so persistence, uploads and
 * export jobs all receive the same error shape.
 */
export async function request(url, options = {}) {
  const { timeoutMs, ...fetchOptions } = options;
  let controller;
  let timer;
  if (Number.isFinite(timeoutMs) && timeoutMs > 0 && !fetchOptions.signal) {
    controller = new AbortController();
    fetchOptions.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  try {
    const response = await fetch(url, fetchOptions);
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch { data = { error: text }; }
    }
    if (!response.ok) {
      if (response.status === 401 && !url.startsWith('/api/auth/')) globalThis.window?.dispatchEvent(new Event('floc-session-expired'));
      const error = new Error(data.error || `Request failed (${response.status}).`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  } catch (cause) {
    if (controller?.signal.aborted) {
      const error = new Error(`Request timed out after ${timeoutMs} ms.`);
      error.code = 'ETIMEDOUT';
      error.cause = cause;
      throw error;
    }
    throw cause;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
