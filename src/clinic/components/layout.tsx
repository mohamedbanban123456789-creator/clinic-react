/**
 * App shell — Sidebar + Header preserved from the Figma export, now wired to
 * react-router and the real session (user names/roles from the backend,
 * live date, real logout). The role switcher from the mock design is removed
 * for secretary accounts (backend sessions are per-role); doctors keep their
 * administrative shortcut into the clinic-operations area.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AppButton, Icon, type IconName, Modal, useToast } from "@/clinic/components/ui"
import { useAuth } from "@/clinic/auth/AuthContext"
import { useChat } from "@/clinic/context/ChatContext"
import { FloatingChat } from "@/clinic/components/Conversation"
import { apiErrorMessage } from "@/clinic/api/client"
import { shiftsApi } from "@/clinic/api/shifts"
import { settingsApi } from "@/clinic/api/admin"
import { arToday } from "@/clinic/lib/format"
import { secretaryRoleTitle } from "@/clinic/lib/constants"

interface NavItem {
  to: string
  label: string
  icon: IconName
  match: string[]
}

const secretaryNav: { section: string; items: NavItem[] }[] = [
  {
    section: "مساحة العمل",
    items: [
      { to: "/secretary", label: "نظرة اليوم", icon: "grid", match: ["/secretary"] },
      { to: "/secretary/checkin", label: "تسجيل الحضور", icon: "userPlus", match: ["/secretary/checkin"] },
      { to: "/secretary/payments", label: "المدفوعات", icon: "wallet", match: ["/secretary/payments"] },
      { to: "/secretary/receipts", label: "أرشيف الإيصالات", icon: "receipt", match: ["/secretary/receipts"] },
    ],
  },
  {
    section: "التشغيل",
    items: [
      { to: "/secretary/closing", label: "الإغلاق اليومي", icon: "chart", match: ["/secretary/closing"] },
      { to: "/display", label: "شاشة الانتظار", icon: "building", match: ["/display"] },
    ],
  },
]

const doctorNav: { section: string; items: NavItem[] }[] = [
  {
    section: "المساحة السريرية",
    items: [
      { to: "/doctor", label: "لوحة الطبيب", icon: "grid", match: ["/doctor"] },
      { to: "/doctor/patients", label: "ملفات المرضى", icon: "users", match: ["/doctor/patients", "/doctor/patients/"] },
      { to: "/doctor/session", label: "الجلسة الحالية", icon: "mic", match: ["/doctor/session"] },
      { to: "/doctor/medications", label: "إدارة الأدوية", icon: "pill", match: ["/doctor/medications"] },
    ],
  },
  {
    section: "الصلاحيات الإدارية",
    items: [
      { to: "/doctor/reports", label: "التقارير الإشرافية والمالية", icon: "chart", match: ["/doctor/reports"] },
      { to: "/doctor/settings", label: "الإعدادات والمستخدمون", icon: "settings", match: ["/doctor/settings"] },
    ],
  },
]

function getInitial(name: string | null | undefined): string {
  if (!name || /^\?+$/.test(name.trim())) return "س"
  const clean = name.trim().replace(/^د\.\s*/, "")
  return clean.charAt(0) || "س"
}

function getSafeName(name: string | null | undefined, isDoctor: boolean, gender?: string): string {
  if (!name || /^\?+$/.test(name.trim())) {
    return isDoctor ? "د. أحمد سامي" : (gender === "MALE" ? "أحمد محمود" : "سارة محمود")
  }
  return name.trim()
}

/**
 * Silent auto-workday guard (Owner decision): the clinic workday (shift) opens
 * automatically and silently — no button, no manual step, no "no open shift"
 * messages. Daily closing stays untouched: the backend rejects re-opening a
 * business date that already has a shift, so attempts after a close fail
 * quietly and the closed report remains.
 */
function AutoWorkday() {
  const queryClient = useQueryClient()
  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => shiftsApi.current(),
    refetchInterval: 60_000,
  })
  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    staleTime: 5 * 60_000,
  })
  const lastAttemptRef = useRef(0)

  useEffect(() => {
    if (shiftQuery.data !== null || shiftQuery.isFetching) return
    const now = Date.now()
    if (now - lastAttemptRef.current < 90_000) return
    lastAttemptRef.current = now
    const openingFloat = settingsQuery.data?.openingFloatMinor ?? 0
    void shiftsApi
      .open(openingFloat)
      .then(async () => {
        await queryClient.invalidateQueries({ queryKey: ["shifts"] })
        await queryClient.invalidateQueries({ queryKey: ["queue"] })
      })
      .catch(() => {
        /* silent — already-open race or closed business date is expected */
      })
  }, [shiftQuery.data, shiftQuery.isFetching, settingsQuery.data, queryClient])

  return null
}

export function Sidebar() {
  const { user, logout, updateName } = useAuth()
  const { notify } = useToast()
  const location = useLocation()
  const navigate = useNavigate()
  const isDoctor = user?.role === "DOCTOR"
  const nav = isDoctor ? doctorNav : secretaryNav
  const displayName = getSafeName(user?.name, isDoctor, user?.gender)
  const initial = getInitial(displayName)
  const roleLabel = isDoctor ? "طبيب/ة نفسية" : secretaryRoleTitle(user?.gender)

  const [showEditName, setShowEditName] = useState(false)
  const [newName, setNewName] = useState("")
  const [nameBusy, setNameBusy] = useState(false)

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <span />
          <Icon name="heart" size={24} />
        </div>
        <div>
          <strong>سكينة</strong>
          <small>لإدارة العيادات النفسية</small>
        </div>
      </div>
      <nav>
        {nav.map((group) => (
          <div className="nav-group" key={group.section}>
            <p>{group.section}</p>
            {group.items.map((item) => {
              const active = item.match.some(
                (m) =>
                  location.pathname === m ||
                  (m !== "/secretary" && m !== "/doctor" && location.pathname.startsWith(m)),
              )
              return (
                <button
                  key={`${group.section}-${item.to}`}
                  className={active ? "nav-item active" : "nav-item"}
                  onClick={() => navigate(item.to)}
                >
                  <Icon name={item.icon} size={19} />
                  <span>{item.label}</span>
                  {active && <i />}
                </button>
              )
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-profile">
        <div className="avatar">{initial}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
            onClick={() => {
              setNewName(user?.name || displayName)
              setShowEditName(true)
            }}
            title="تعديل الاسم"
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayName}
            </span>
            <span style={{ opacity: 0.7, flexShrink: 0, display: "inline-flex" }}>
              <Icon name="edit" size={13} />
            </span>
          </strong>
          <small>{roleLabel}</small>
        </div>
        <button
          className="icon-button"
          title="تسجيل الخروج"
          onClick={() => void logout().then(() => navigate("/login"))}
        >
          <Icon name="logout" size={18} />
        </button>
      </div>

      {showEditName && (
        <Modal
          title="تعديل اسم العرض"
          subtitle="سيظهر هذا الاسم في لوحة التحكم والمحادثات والتقارير."
          onClose={() => setShowEditName(false)}
        >
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault()
              if (!newName.trim() || nameBusy) return
              setNameBusy(true)
              try {
                await updateName(newName.trim())
                notify("تم تحديث الاسم بنجاح")
                setShowEditName(false)
              } catch (err) {
                notify(apiErrorMessage(err), "error")
              } finally {
                setNameBusy(false)
              }
            }}
          >
            <label className="field">
              <span>الاسم <b>*</b></span>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="أدخل الاسم الجديد"
                autoFocus
              />
            </label>
            <div className="modal-actions">
              <AppButton variant="outline" type="button" onClick={() => setShowEditName(false)}>
                إلغاء
              </AppButton>
              <AppButton type="submit" disabled={nameBusy || !newName.trim()}>
                {nameBusy ? "جارٍ الحفظ..." : "حفظ التعديل"}
              </AppButton>
            </div>
          </form>
        </Modal>
      )}
    </aside>
  )
}

export function Header({ title, onMenu }: { title: string; onMenu: () => void }) {
  const { user } = useAuth()
  const { toggleChat, unreadCount } = useChat()
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const isDoctor = user?.role === "DOCTOR"
  const displayName = getSafeName(user?.name, isDoctor, user?.gender)
  const initial = getInitial(displayName)

  const searchTarget = useMemo(() => {
    if (query.trim().length >= 3) {
      return isDoctor ? "/doctor/patients?q=" : "/secretary/checkin?q="
    }
    return null
  }, [query, isDoctor])

  return (
    <header className="page-head">
      <div className="page-title">
        <h1>{title}</h1>
        <small>{arToday()}</small>
      </div>
      <div className="header-actions">
        <button type="button" className="nav-toggle" onClick={onMenu} aria-label="فتح قائمة التنقل">
          <Icon name="menu" size={20} />
        </button>
        <form
          className="global-search"
          onSubmit={(e) => {
            e.preventDefault()
            if (searchTarget) navigate(searchTarget + encodeURIComponent(query.trim()))
          }}
        >
          <Icon name="search" size={18} />
          <input
            aria-label="البحث العام"
            placeholder="ابحث عن مريض بالاسم أو الهاتف..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </form>
        <button
          type="button"
          className="icon-button notification"
          title="التواصل الداخلي والإشعارات"
          onClick={toggleChat}
          style={{ cursor: "pointer" }}
        >
          <Icon name="bell" size={19} />
          {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
        </button>
        <button
          className="mini-profile"
          onClick={() => navigate(isDoctor ? "/doctor" : "/secretary")}
          title="مساحة العمل"
        >
          <span className="avatar small">{initial}</span>
          <span>
            <strong>{displayName.split(" ").slice(0, 2).join(" ")}</strong>
            <small>{isDoctor ? "طبيب/ة" : "استقبال"}</small>
          </span>
          <Icon name="chevron" size={14} />
        </button>
      </div>
    </header>
  )
}

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  const [navOpen, setNavOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setNavOpen(false)
  }, [location.pathname])

  return (
    <>
      <div className={`app ${navOpen ? "nav-open" : ""}`} dir="rtl">
        <Sidebar />
        {navOpen && (
          <button
            type="button"
            className="nav-overlay"
            aria-label="إغلاق قائمة التنقل"
            onClick={() => setNavOpen(false)}
          />
        )}
        <div className="main-shell">
          <Header title={title} onMenu={() => setNavOpen((v) => !v)} />
          <main className="page">{children}</main>
        </div>
        <FloatingChat />
        <AutoWorkday />
      </div>
    </>
  )
}

