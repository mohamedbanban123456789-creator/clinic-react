/**
 * Formatting helpers — preserved from the Figma export (arNum / money) and
 * extended with date/time helpers that follow the same Arabic (ar-EG) locale.
 */

export const arNum = (value: number): string =>
  new Intl.NumberFormat("ar-EG").format(value)

/** Money label per design language: ج.م. (EGP). */
export const money = (value: number): string => `${arNum(value)} ج.م.`

/** Money in minor units (backend integers) -> major display value. */
export const minorToMajor = (minor: number): number => minor / 100

export const moneyMinor = (minor: number): string => money(minorToMajor(minor))

export const arDate = (iso: string | null | undefined): string => {
  if (!iso) return "—"
  return new Intl.DateTimeFormat("ar-EG", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(iso))
}

export const arDateShort = (iso: string | null | undefined): string => {
  if (!iso) return "—"
  return new Intl.DateTimeFormat("ar-EG", {
    month: "short",
    day: "numeric",
  }).format(new Date(iso))
}

export const arTime = (iso: string | null | undefined): string => {
  if (!iso) return "—"
  return new Intl.DateTimeFormat("ar-EG", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso))
}

export const arDateTime = (iso: string | null | undefined): string => {
  if (!iso) return "—"
  return `${arDate(iso)} · ${arTime(iso)}`
}

/** "٨ يوليو، ١١:٣٠ ص" style used by the receipts table. */
export const arDateTimeCompact = (iso: string | null | undefined): string => {
  if (!iso) return "—"
  return `${new Intl.DateTimeFormat("ar-EG", {
    month: "long",
    day: "numeric",
  }).format(new Date(iso))}، ${arTime(iso)}`
}

const arDayFmt = new Intl.DateTimeFormat("ar-EG", {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
})

/** "الثلاثاء، ٨ يوليو ٢٠٢٦" — header date pill format. */
export const arToday = (d: Date = new Date()): string => arDayFmt.format(d)

/** Greeting for the welcome strip (صباح الخير / مساء الخير). */
export const arGreeting = (d: Date = new Date()): string =>
  d.getHours() < 12 ? "صباح الخير" : "مساء الخير"

/** Minutes elapsed since an ISO timestamp (for live "بدأت منذ X دقيقة"). */
export const minutesSince = (iso: string | null | undefined): number => {
  if (!iso) return 0
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000))
}

/** mm:ss timer using Arabic-Indic digits, e.g. ٢٣:٤٧ */
export const arTimer = (totalSeconds: number): string => {
  const s = Math.max(0, Math.floor(totalSeconds))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  const twoDigits = String(ss).padStart(2, "0").replace(
    /\d/g,
    (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)],
  )
  return `${arNum(mm)}:${twoDigits}`
}

/** Short relative "منذ ٣ أسابيع" style for last-visit labels. */
export const arAgo = (iso: string | null | undefined): string => {
  if (!iso) return "لم تُسجل زيارة"
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return "اليوم"
  if (days < 7) return `منذ ${arNum(days)} ${days === 1 ? "يوم" : "أيام"}`
  if (days < 30) {
    const w = Math.floor(days / 7)
    return `منذ ${arNum(w)} ${w === 1 ? "أسبوع" : "أسابيع"}`
  }
  if (days < 365) {
    const m = Math.floor(days / 30)
    return `منذ ${arNum(m)} ${m === 1 ? "شهر" : "أشهر"}`
  }
  const y = Math.floor(days / 365)
  return `منذ ${arNum(y)} ${y === 1 ? "سنة" : "سنوات"}`
}

export const ageFromDob = (dob: string | null | undefined): number | null => {
  if (!dob) return null
  const d = new Date(dob)
  if (Number.isNaN(d.getTime())) return null
  const diff = Date.now() - d.getTime()
  return Math.floor(diff / (365.25 * 86400000))
}

/** Date input value (YYYY-MM-DD) from an ISO string. */
export const toDateInput = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toISOString().slice(0, 10) : ""

export const arPercent = (part: number, total: number): string => {
  if (total <= 0) return "٠٪"
  const pct = Math.round((part / total) * 100)
  return `${arNum(pct)}٪`
}
