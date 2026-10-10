/**
 * Who you are, kept in localStorage: a random secret token (so a refresh puts you back in your
 * seat) and the last name you used. No accounts, no passwords. Storage can be unavailable
 * (private mode, blocked cookies), so every access is guarded and we fall back to memory.
 */
const memory = new Map<string, string>();

function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}
function set(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* memory only */
  }
}

export function playerToken(): string {
  let t = get('omni.token');
  if (!t || t.length < 16) {
    t = crypto.randomUUID().replace(/-/g, '');
    set('omni.token', t);
  }
  return t;
}

export const savedName = () => get('omni.name') ?? '';
export const saveName = (name: string) => set('omni.name', name);
export const savedPref = (key: string) => get(`omni.pref.${key}`);
export const savePref = (key: string, value: string) => set(`omni.pref.${key}`, value);
