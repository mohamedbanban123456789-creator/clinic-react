/**
 * Shared UI primitives — preserved verbatim from the Figma export
 * (src/App.tsx of the supplied design), with the two TypeScript syntax
 * errors fixed (missing `;` separators in type literals at L70 / L273).
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"

export type IconName =
  | "grid"
  | "user"
  | "userPlus"
  | "userCheck"
  | "wallet"
  | "banknote"
  | "receipt"
  | "message"
  | "chart"
  | "users"
  | "mic"
  | "activity"
  | "clipboardCheck"
  | "timer"
  | "file"
  | "pill"
  | "settings"
  | "building"
  | "search"
  | "bell"
  | "calendar"
  | "chevron"
  | "clock"
  | "alert"
  | "check"
  | "arrow"
  | "more"
  | "phone"
  | "lock"
  | "send"
  | "sparkle"
  | "plus"
  | "pause"
  | "stop"
  | "eye"
  | "logout"
  | "heart"
  | "edit"
  | "menu"

const iconPaths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  /* Lucide User — single person, for in-field identity glyphs */
  user: (
    <>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>
  ),
  userPlus: (
    <>
      <path d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8" cy="7" r="4" />
      <path d="M19 8v6M22 11h-6" />
    </>
  ),
  /* Lucide UserCheck — calling the next patient is a summon, not a phone call */
  userCheck: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="m16 11 2 2 4-4" />
    </>
  ),
  /* Lucide Activity (pulse) — live clinical session */
  activity: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  /* Lucide ClipboardCheck — pending report review (NOT AI) */
  clipboardCheck: (
    <>
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <path d="m9 14 2 2 4-4" />
    </>
  ),
  /* Lucide Banknote — net cash / treasury */
  banknote: (
    <>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </>
  ),
  /* Lucide Timer — average session duration */
  timer: (
    <>
      <path d="M10 2h4" />
      <path d="m12 14 3-3" />
      <circle cx="12" cy="14" r="8" />
    </>
  ),
  wallet: (
    <>
      <path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v12H5a3 3 0 0 1-3-3V6" />
      <path d="M16 13h2" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" />
      <path d="M9 7h6M9 11h6M9 15h3" />
    </>
  ),
  message: (
    <>
      <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
      <path d="M8 9h8M8 13h5" />
    </>
  ),
  chart: (
    <>
      <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="4" />
      <path d="M20 8v6M23 11h-6" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8" />
    </>
  ),
  file: (
    <>
      <path d="M6 2h9l5 5v15H6Z" />
      <path d="M14 2v6h6M9 13h6M9 17h6" />
    </>
  ),
  pill: (
    <>
      <rect x="2.5" y="7.5" width="19" height="9" rx="4.5" />
      <path d="M12 7.5v9" />
    </>
  ),
  settings: (
    <>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33 1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  building: (
    <>
      <path d="M3 21h18M5 21V5l7-3 7 3v16M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3 2.5 20h19Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  arrow: (
    <>
      <path d="M19 12H5M11 18l-6-6 6-6" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  phone: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.8.7a2 2 0 0 1 1.8 2.1Z" />
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="3" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  send: (
    <>
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4Z" />
      <path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8Z" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  pause: (
    <>
      <path d="M8 5v14M16 5v14" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  eye: (
    <>
      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  logout: (
    <>
      <path d="M10 17l5-5-5-5M15 12H3M15 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5" />
    </>
  ),
  heart: (
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />
  ),
  edit: (
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
}

export function Icon({
  name,
  size = 20,
}: {
  name: IconName
  size?: number
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {iconPaths[name]}
    </svg>
  )
}

export function AppButton({
  children,
  variant = "primary",
  icon,
  onClick,
  type = "button",
  disabled,
  className = "",
  title,
}: {
  children: ReactNode
  variant?: "primary" | "secondary" | "outline" | "danger" | "ghost"
  icon?: IconName
  onClick?: () => void
  type?: "button" | "submit"
  disabled?: boolean
  className?: string
  title?: string
}) {
  return (
    <button
      className={`btn btn-${variant} ${className}`}
      onClick={onClick}
      type={type}
      disabled={disabled}
      title={title}
    >
      {icon && <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  )
}

export function StatCard({
  label,
  value,
  suffix,
  hint,
  icon,
  tone,
}: {
  label: string
  value: string
  suffix?: string
  hint: string
  icon: IconName
  tone: string
}) {
  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-icon">
        <Icon name={icon} size={21} />
      </div>
      <div>
        <p>{label}</p>
        <strong>
          {value} {suffix && <small>{suffix}</small>}
        </strong>
        <span>{hint}</span>
      </div>
    </article>
  )
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  danger = false,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  danger?: boolean
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className={`modal ${danger ? "danger-modal" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="إغلاق">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Toast system — preserved design (dark pill + check), extended with   */
/* an error variant that reuses design danger tokens.                   */
/* ------------------------------------------------------------------ */

interface ToastState {
  message: string
  variant: "success" | "error"
  id: number
}

const ToastContext = createContext<{
  notify: (message: string, variant?: "success" | "error") => void
}>({ notify: () => {} })

let toastCounter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const notify = (message: string, variant: "success" | "error" = "success") => {
    toastCounter += 1
    setToast({ message, variant, id: toastCounter })
  }

  return (
    <ToastContext.Provider value={{ notify }}>
      {children}
      {toast && (
        <div key={toast.id} className={`toast ${toast.variant === "error" ? "toast-error" : ""}`}>
          <span className="toast-check">
            <Icon name={toast.variant === "error" ? "alert" : "check"} size={16} />
          </span>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  return useContext(ToastContext)
}

/* ------------------------------------------------------------------ */
/* Loading skeletons — additive styles (see index.css additions).       */
/* ------------------------------------------------------------------ */

export function SkeletonBlock({
  lines = 3,
  className = "",
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={`skeleton-block ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton-line" />
      ))}
    </div>
  )
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string
  onRetry?: () => void
}) {
  return (
    <div className="error-state">
      <Icon name="alert" size={30} />
      <h3>تعذر تحميل البيانات</h3>
      <p>{message}</p>
      {onRetry && <AppButton variant="outline" onClick={onRetry}>إعادة المحاولة</AppButton>}
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon: IconName
  title: string
  text: string
  action?: ReactNode
}) {
  return (
    <div className="empty-state">
      <Icon name={icon} size={34} />
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

/** Generic confirm modal built on the design's Modal. */
export function ConfirmModal({
  title,
  subtitle,
  confirmLabel = "تأكيد",
  onConfirm,
  onClose,
  danger = false,
  children,
  busy = false,
}: {
  title: string
  subtitle?: string
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
  danger?: boolean
  children?: ReactNode
  busy?: boolean
}) {
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose} danger={danger}>
      {children}
      <div className="modal-actions">
        <AppButton variant="outline" onClick={onClose} disabled={busy}>
          إلغاء
        </AppButton>
        <AppButton variant={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
          {busy ? "جارٍ التنفيذ..." : confirmLabel}
        </AppButton>
      </div>
    </Modal>
  )
}

/** Small select styled like the design's compact filter selects. */
export function SelectField({
  label,
  value,
  onChange,
  options,
  className = "",
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <label className={`field ${className}`}>
      {label && <span>{label}</span>}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

export { FormEvent }
