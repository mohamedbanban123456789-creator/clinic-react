/**
 * ArabicDateField — Egyptian day/month/year date input with a proper
 * Arabic calendar popover (design review A5: no mm/dd/yyyy anywhere).
 *
 * - Value contract is ISO "yyyy-mm-dd" (unchanged backend format).
 * - Display/edit format is dd/mm/yyyy with Arabic-Indic digits, matching
 *   the app-wide arNum typography; typing accepts Latin or Arabic digits.
 * - The popover is a lightweight month grid (Sat-first week, ar-EG locale)
 *   in the shared glass language; no external date library.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Icon } from "@/clinic/components/ui"

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩"

const toArabicDigits = (s: string): string =>
  s.replace(/\d/g, (d) => AR_DIGITS[Number(d)])

const toLatinDigits = (s: string): string =>
  s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)))

const MONTHS_AR = [
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر",
]

/** Weekday headers — Saturday-first (ar-EG convention). */
const WEEKDAYS_AR = ["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"]

const isoToDmy = (iso: string | null | undefined): string => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ""
  const [y, m, d] = iso.split("-")
  return toArabicDigits(`${d}/${m}/${y}`)
}

const pad2 = (n: number) => String(n).padStart(2, "0")

/** Parse user text (dd/mm/yyyy, tolerant of partial slashes) -> ISO | null. */
const parseDmy = (raw: string): string | null => {
  const latin = toLatinDigits(raw).replace(/[^\d]/g, "")
  if (latin.length !== 8) return null
  const d = Number(latin.slice(0, 2))
  const m = Number(latin.slice(2, 4))
  const y = Number(latin.slice(4))
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${pad2(m)}-${pad2(d)}`
}

/** Auto-format typed digits into dd/mm/yyyy as the user goes. */
const formatTyping = (raw: string): string => {
  const latin = toLatinDigits(raw).replace(/[^\d]/g, "").slice(0, 8)
  if (latin.length === 0) return ""
  const parts = [latin.slice(0, 2), latin.slice(2, 4), latin.slice(4, 8)].filter(Boolean)
  return toArabicDigits(parts.join("/"))
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

export function ArabicDateField({
  value,
  onChange,
  placeholder = "يوم/شهر/سنة",
  invalid,
  disabled,
  maxToday = false,
  id,
}: {
  value: string
  onChange: (iso: string) => void
  placeholder?: string
  invalid?: boolean
  disabled?: boolean
  maxToday?: boolean
  id?: string
}) {
  const [text, setText] = useState(isoToDmy(value))
  const [open, setOpen] = useState(false)
  const [invalidText, setInvalidText] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  // Keep the visible text in sync when the parent resets/loads the value.
  useEffect(() => {
    setText(isoToDmy(value))
    setInvalidText(false)
  }, [value])

  // Close the popover on outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const selected: Date | null = useMemo(
    () => (value ? new Date(`${value}T00:00:00`) : null),
    [value],
  )

  const [view, setView] = useState(() => {
    const base = selected ?? new Date()
    return { y: base.getFullYear(), m: base.getMonth() }
  })
  useEffect(() => {
    if (open) {
      const base = selected ?? new Date()
      setView({ y: base.getFullYear(), m: base.getMonth() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const today = new Date()
  const grid = useMemo(() => {
    const first = new Date(view.y, view.m, 1)
    // Saturday-first offset: Sat=6 in getDay(); map Sat->0 ... Fri->6
    const offset = (first.getDay() + 1) % 7
    const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
    const cells: { date: Date; inMonth: boolean }[] = []
    const prevDays = new Date(view.y, view.m, 0).getDate()
    for (let i = offset - 1; i >= 0; i--) {
      cells.push({ date: new Date(view.y, view.m - 1, prevDays - i), inMonth: false })
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ date: new Date(view.y, view.m, d), inMonth: true })
    }
    while (cells.length % 7 !== 0 || cells.length < 42) {
      const last = cells[cells.length - 1]?.date ?? new Date(view.y, view.m, 1)
      cells.push({ date: new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1), inMonth: false })
      if (cells.length >= 42) break
    }
    return cells
  }, [view])

  const shiftMonth = (delta: number) => {
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1)
      return { y: d.getFullYear(), m: d.getMonth() }
    })
  }

  const commit = (iso: string) => {
    onChange(iso)
    setOpen(false)
  }

  const onFieldBlur = () => {
    if (!text.trim()) {
      setInvalidText(false)
      return
    }
    const iso = parseDmy(text)
    if (iso) {
      setInvalidText(false)
      if (iso !== value) onChange(iso)
    } else {
      setInvalidText(true)
    }
  }

  const maxISO = maxToday
    ? `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`
    : undefined

  return (
    <div className="date-field" ref={rootRef}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        dir="ltr"
        style={{ textAlign: "start" }}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={invalid || invalidText}
        className={invalid || invalidText ? "date-input-invalid" : ""}
        onChange={(e) => {
          setText(formatTyping(e.target.value))
          setInvalidText(false)
        }}
        onBlur={onFieldBlur}
        onFocus={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            onFieldBlur()
          }
        }}
      />
      <button
        type="button"
        className="date-toggle"
        tabIndex={-1}
        disabled={disabled}
        aria-label="اختر التاريخ من التقويم"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="calendar" size={17} />
      </button>

      {open && (
        <div className="date-popover" role="dialog" aria-label="اختيار التاريخ">
          <div className="date-popover-head">
            <button type="button" onClick={() => shiftMonth(-1)} aria-label="الشهر السابق" disabled={disabled}>
              <Icon name="chevron" size={16} />
            </button>
            <strong>
              {MONTHS_AR[view.m]} {toArabicDigits(String(view.y))}
            </strong>
            <button type="button" className="chev-next" onClick={() => shiftMonth(1)} aria-label="الشهر التالي" disabled={disabled}>
              <Icon name="chevron" size={16} />
            </button>
          </div>
          <div className="date-grid date-weekdays">
            {WEEKDAYS_AR.map((w) => (
              <span key={w}>{w.slice(2)}</span>
            ))}
          </div>
          <div className="date-grid date-days">
            {grid.map(({ date, inMonth }) => {
              const isToday = sameDay(date, today)
              const isSelected = selected ? sameDay(date, selected) : false
              const beyond =
                maxISO !== undefined &&
                `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}` > maxISO
              const iso = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
              return (
                <button
                  type="button"
                  key={iso}
                  className={[
                    "date-cell",
                    inMonth ? "" : "out",
                    isSelected ? "sel" : "",
                    isToday ? "today" : "",
                    beyond ? "beyond" : "",
                  ].join(" ")}
                  disabled={disabled}
                  onClick={() => commit(iso)}
                >
                  {toArabicDigits(String(date.getDate()))}
                </button>
              )
            })}
          </div>
          <div className="date-popover-foot">
            <button type="button" className="date-today-btn" onClick={() => {
              const iso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`
              commit(iso)
            }}>
              اليوم
            </button>
            <button type="button" className="date-clear-btn" onClick={() => { onChange(""); setOpen(false) }}>
              مسح
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
