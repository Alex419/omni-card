import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Feedback } from '@omni/shared';
import { supabaseInsert } from '../supabase';

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
    await supabaseInsert(this.url, this.key, 'feedback', {
      category: f.category,
      message: f.message,
      contact: f.contact || null,
      room: f.room || null,
      user_agent: f.userAgent?.slice(0, 300) ?? null,
    });
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
