import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type Role = "user" | "assistant";
export type StoredMessage = { role: Role; content: string };

let cached: SupabaseClient | null = null;

/** Returns a server-side Supabase client, or null if not configured (app still runs without a DB). */
export function db(): SupabaseClient | null {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  cached = createClient(url, key, { auth: { persistSession: false } });
  return cached;
}

export function dbConfigured(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function createSession(title: string): Promise<string | null> {
  const c = db();
  if (!c) return null;
  const { data, error } = await c
    .from("sessions")
    .insert({ title: title.slice(0, 120) })
    .select("id")
    .single();
  if (error) {
    console.error("createSession:", error.message);
    return null;
  }
  return data.id as string;
}

export async function addMessages(sessionId: string, msgs: StoredMessage[]): Promise<void> {
  const c = db();
  if (!c) return;
  const rows = msgs.map((m) => ({ session_id: sessionId, role: m.role, content: m.content }));
  const { error } = await c.from("messages").insert(rows);
  if (error) console.error("addMessages:", error.message);
}

export async function getMessages(sessionId: string): Promise<StoredMessage[]> {
  const c = db();
  if (!c) return [];
  const { data, error } = await c
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getMessages:", error.message);
    return [];
  }
  return (data ?? []) as StoredMessage[];
}
