/**
 * Keep the editor's HTTP boundary in one place so persistence, uploads and
 * export jobs all receive the same error shape.
 */
export async function request(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};
  if (text) {
    try { data = JSON.parse(text); } catch { data = { error: text }; }
  }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}
