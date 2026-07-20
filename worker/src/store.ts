import { emptyState, type TaskState } from './types'

/**
 * KV üzerinde görev durumunun okunup yazılması.
 *
 * Kişisel tek kullanıcılı uygulama olduğu için durum tek bir anahtar altında tutulur.
 * (İleride çok kullanıcı gerekirse anahtar kullanıcı id'siyle namespace'lenebilir.)
 */

const STATE_KEY = 'state'

export async function getState(kv: KVNamespace, now: string): Promise<TaskState> {
  const raw = await kv.get(STATE_KEY, 'json')
  if (!raw) return emptyState(now)
  return raw as TaskState
}

export async function putState(kv: KVNamespace, state: TaskState): Promise<void> {
  await kv.put(STATE_KEY, JSON.stringify(state))
}
