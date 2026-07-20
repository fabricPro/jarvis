import type { Task, TaskState } from './types'

/**
 * Deterministik gün sonu raporu.
 *
 * "rapor" komutu Gemini'ye/redüktöre gitmeden Worker'da yakalanır ve mevcut KV
 * durumundan garanti formatlı bir metin üretilir. Böylece rapor biçimi anahtar
 * olsun olmasın tutarlıdır ve bir Gemini çağrısı harcanmaz.
 *
 * Tarih/saat, kişisel kullanım için yerel saat diliminde biçimlenir
 * (varsayılan Europe/Istanbul; REPORT_TZ ile override edilebilir).
 */

const DEFAULT_TZ = 'Europe/Istanbul'

const REPORT_COMMAND =
  /^(rapor|raporu|raporla|rapor ver|rapor çıkar|rapor cikar|rapor göster|rapor goster|gün ?sonu raporu|gun ?sonu raporu|günün raporu|gunun raporu|bugünün raporu|bugunun raporu)$/

/** Mesaj yalnızca bir rapor talebi mi? (normal görev metnini kaçırmamak için katı) */
export function isReportCommand(message: string): boolean {
  return REPORT_COMMAND.test(message.trim().toLocaleLowerCase('tr-TR'))
}

function dtParts(iso: string, tz: string): Record<string, string> {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  return Object.fromEntries(fmt.formatToParts(new Date(iso)).map((p) => [p.type, p.value]))
}

function localDate(iso: string, tz: string): string {
  const p = dtParts(iso, tz)
  return `${p.year}-${p.month}-${p.day}`
}

function localTime(iso: string, tz: string): string {
  const p = dtParts(iso, tz)
  return `${p.hour}:${p.minute}`
}

interface CompletedItem {
  label: string
  at: string // ISO
}

/** Bugün (yerel) tamamlanan görev ve alt görevler. */
function completedToday(state: TaskState, today: string, tz: string): CompletedItem[] {
  const items: CompletedItem[] = []
  for (const t of state.tasks) {
    if (t.completedAt && localDate(t.completedAt, tz) === today) {
      items.push({ label: t.title, at: t.completedAt })
    }
    for (const s of t.subtasks) {
      if (s.completedAt && localDate(s.completedAt, tz) === today) {
        items.push({ label: `${t.title} › ${s.title}`, at: s.completedAt })
      }
    }
  }
  return items.sort((a, b) => a.at.localeCompare(b.at))
}

function subtaskProgress(t: Task): string {
  const total = t.subtasks.length
  if (total === 0) return ''
  const done = t.subtasks.filter((s) => s.done).length
  return ` (${done}/${total})`
}

export function buildReport(state: TaskState, now: string, tz: string = DEFAULT_TZ): string {
  const today = localDate(now, tz)
  const open = state.tasks.filter((t) => !t.done)
  const done = state.tasks.filter((t) => t.done)
  const doneToday = completedToday(state, today, tz)

  const lines: string[] = []
  lines.push(`📋 Gün Sonu Raporu — ${today}`)
  lines.push(`Özet: ${open.length} açık · ${done.length} tamamlandı (toplam ${state.tasks.length} görev)`)

  // Bugün tamamlananlar
  lines.push('')
  if (doneToday.length > 0) {
    lines.push(`✅ Bugün tamamlananlar (${doneToday.length}):`)
    for (const it of doneToday) lines.push(`  • ${it.label} (${localTime(it.at, tz)})`)
  } else {
    lines.push('✅ Bugün tamamlanan görev yok.')
  }

  // Açık görevler (gruba göre)
  lines.push('')
  if (open.length > 0) {
    lines.push(`📌 Açık görevler (${open.length}):`)
    const groups = new Map<string, Task[]>()
    for (const t of open) {
      const key = t.group?.trim() || 'Diğer'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(t)
    }
    for (const [group, tasks] of groups) {
      lines.push(`  ${group}`)
      for (const t of tasks) lines.push(`    ○ ${t.title}${subtaskProgress(t)}`)
    }
  } else {
    lines.push('📌 Açık görev kalmadı — hepsi bitti! 🎉')
  }

  return lines.join('\n')
}
