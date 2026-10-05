async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.stale = data.stale === true;
    throw err;
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  meta: () => call('GET', '/api/meta'),
  readme: () => call('GET', '/api/readme'),
  day: (date) => call('GET', `/api/day/${date}`),
  patchDay: (date, fields) => call('PATCH', `/api/day/${date}`, fields),
  addEntry: (date, list, entry) => call('POST', `/api/day/${date}/${list}`, entry),
  updateEntry: (date, list, id, entry) => call('PUT', `/api/day/${date}/${list}/${id}`, entry),
  deleteEntry: (date, list, id) => call('DELETE', `/api/day/${date}/${list}/${id}`),
  days: (from, to) => call('GET', `/api/days?from=${from}&to=${to}`),
  journal: (q, tag) => call('GET', `/api/journal?q=${enc(q || '')}&tag=${enc(tag || '')}`),
  doc: (name) => call('GET', `/api/doc/${name}`),
  saveDoc: (name, data) => call('PUT', `/api/doc/${name}`, data),
  items: (coll) => call('GET', `/api/${coll}`),
  createItem: (coll, data) => call('POST', `/api/${coll}`, data),
  updateItem: (coll, id, data) => call('PUT', `/api/${coll}/${enc(id)}`, data),
  deleteItem: (coll, id) => call('DELETE', `/api/${coll}/${enc(id)}`),
  mealPlans: () => call('GET', '/api/mealplans'),
  mealPlan: (monday) => call('GET', `/api/mealplan/${monday}`),
  saveMealPlan: (monday, plan) => call('PUT', `/api/mealplan/${monday}`, plan),
  foodSearch: (q, limit) => call('GET', `/api/food-search?q=${enc(q || '')}${limit ? `&limit=${limit}` : ''}`),
  usdaFood: (id) => call('GET', `/api/usda-food/${enc(id)}`),
  starterRecipes: () => call('GET', '/api/starter-recipes'),
  backups: () => call('GET', '/api/backups'),
  backupNow: () => call('POST', '/api/backups', {}),
  backupDiff: (day) => call('GET', `/api/backups/${day}`),
  restoreBackup: (day, body) => call('POST', `/api/backups/${day}/restore`, body),
};
