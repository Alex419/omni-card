/**
 * Insert rows into a Supabase table through its REST API (PostgREST). A plain fetch keeps us
 * free of the SDK for the only thing we do: inserts. Used by feedback and analytics.
 */
export async function supabaseInsert(url: string, key: string, table: string, rows: object | object[]) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
    apikey: key,
  };
  // New `sb_secret_` keys go only in `apikey`; legacy service_role JWTs also go in Authorization.
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`Supabase insert into ${table} failed: ${res.status} ${await res.text()}`);
}
