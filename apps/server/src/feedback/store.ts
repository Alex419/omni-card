import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Feedback } from '@omni/shared';

export interface FeedbackRecord extends Feedback {
  userAgent?: string;
}

/**
 * Where feedback ends up. The HTTP handler only knows this interface, so swapping Supabase for
 * another database means writing one new class, not touching the request handling.
 */
export interface FeedbackStore {
  readonly name: string;
  save(f: FeedbackRecord): Promise<void>;
}

/**
 * Supabase (hosted Postgres) through its auto-generated REST API (PostgREST). A plain fetch keeps
 * us free of the SDK for a single insert. Run supabase/migrations/*.sql once to create the table.
 */
export class SupabaseFeedbackStore implements FeedbackStore {
  readonly name = 'supabase';
  constructor(
    private url: string,
    private key: string,
  ) {}

  async save(f: FeedbackRecord): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      apikey: this.key,
    };
    // New `sb_secret_` keys go only in `apikey`; legacy service_role JWTs also go in Authorization.
    if (!this.key.startsWith('sb_')) headers.Authorization = `Bearer ${this.key}`;
    const res = await fetch(`${this.url.replace(/\/$/, '')}/rest/v1/feedback`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        category: f.category,
        message: f.message,
        contact: f.contact || null,
        room: f.room || null,
        user_agent: f.userAgent?.slice(0, 300) ?? null,
      }),
    });
    if (!res.ok) throw new Error(`Supabase insert failed: ${res.status} ${await res.text()}`);
  }
}

/** Local development fallback: one JSON object per line in a file. */
export class FileFeedbackStore implements FeedbackStore {
  readonly name = 'file';
  constructor(private path: string) {}

  async save(f: FeedbackRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify({ at: new Date().toISOString(), ...f }) + '\n');
  }
}
