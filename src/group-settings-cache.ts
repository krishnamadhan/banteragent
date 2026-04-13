import { supabase } from "./supabase.js";

interface CachedSettings { muted: boolean; auto_response: boolean; ts: number }
const cache = new Map<string, CachedSettings>();
const TTL_MS = 30_000; // 30 seconds — reduces serial DB calls per message to ≤1

/** Call after !mute / !unmute so the next message sees fresh state immediately */
export function invalidateGroupSettingsCache(groupId: string): void {
  cache.delete(groupId);
}

/**
 * Fetch muted + auto_response in a single Supabase call, cached per group.
 * Replaces two separate sequential queries in listener.ts hot path.
 */
export async function getGroupSettings(groupId: string): Promise<{ muted: boolean; auto_response: boolean }> {
  const hit = cache.get(groupId);
  if (hit && Date.now() - hit.ts < TTL_MS) {
    return { muted: hit.muted, auto_response: hit.auto_response };
  }
  const { data } = await supabase
    .from("ba_group_settings")
    .select("muted, auto_response")
    .eq("group_id", groupId)
    .maybeSingle();
  const settings: CachedSettings = {
    muted: data?.muted ?? false,
    auto_response: data?.auto_response ?? true,
    ts: Date.now(),
  };
  cache.set(groupId, settings);
  return { muted: settings.muted, auto_response: settings.auto_response };
}
