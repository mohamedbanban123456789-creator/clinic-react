/**
 * App shell — Sidebar + Header preserved from the Figma export, now wired to
 * react-router and the real session (user names/roles from the backend,
 * live date, real logout). The role switcher from the mock design is removed
 * for secretary accounts (backend sessions are per-role); doctors keep their
 * administrative shortcut into the clinic-operations area.
 */

import { useMemo, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { Icon, type IconName } from "@/components/ui"
import { useAuth } from "@/auth/AuthContext"
import { arToday } from "@/lib/format"

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
      { to: "/chat", label: "التواصل الداخلي", icon: "message", match: ["/chat"] },
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
      { to: "/doctor/soap", label: "تقارير SOAP", icon: "file", match: ["/doctor/soap"] },
      { to: "/doctor/medications", label: "إدارة الأدوية", icon: "pill", match: ["/doctor/medications"] },
    ],
  },
  {
    section: "الصلاحيات الإدارية",
    items: [
      { to: "/secretary", label: "تشغيل العيادة", icon: "building", match: ["/secretary"] },
      { to: "/secretary/closing", label: "الخزينة اليومية", icon: "wallet", match: ["/secretary/closing"] },
      { to: "/doctor/reports", label: "التقارير الإشرافية", icon: "chart", match: ["/doctor/reports"] },
      { to: "/doctor/settings", label: "الإعدادات والمستخدمون", icon: "lock", match: ["/doctor/settings"] },
    ],
  },
]

export function Sidebar() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const isDoctor = user?.role === "DOCTOR"
  const nav = isDoctor ? doctorNav : secretaryNav
  const initial = user?.name?.trim().charAt(0) ?? "؟"
  const roleLabel = isDoctor ? "طبيب/ة نفسية" : "مسؤولة الاستقبال"

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
      <div className="role-switch">
        <button className={!isDoctor ? "active" : ""} onClick={() => navigate("/secretary")}>
          الاستقبال
        </button>
        <button
          className={isDoctor ? "active" : ""}
          onClick={() => navigate("/doctor")}
          disabled={!isDoctor}
          title={isDoctor ? "" : "هذه المساحة متاحة لحساب الطبيب"}
        >
          الطبيب
        </button>
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
        <div>
          <strong>{user?.name ?? "—"}</strong>
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
    </aside>
  )
}

export function Header({ title }: { title: string }) {
  const { user } = useAuth()
  const [query, setQuery] = useState("")
  const navigate = useNavigate()
  const isDoctor = user?.role === "DOCTOR"
  const initial = user?.name?.trim().charAt(0) ?? "؟"

  const searchTarget = useMemo(() => {
    if (query.trim().length >= 3) {
      return isDoctor ? "/doctor/patients?q=" : "/secretary/checkin?q="
    }
    return null
  }, [query, isDoctor])

  return (
    <header className="topbar">
      <div className="page-title">
        <small>
          الرئيسية <Icon name="chevron" size={12} />
        </small>
        <h1>{title}</h1>
      </div>
      <div className="header-actions">
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
        <div className="date-pill">
          <Icon name="calendar" size={17} />
          <span>{arToday()}</span>
        </div>
        <Link to="/chat" className="icon-button notification" title="الإشعارات">
          <Icon name="bell" size={19} />
          <i />
        </Link>
        <button
          className="mini-profile"
          onClick={() => navigate(isDoctor ? "/doctor" : "/secretary")}
          title="مساحة العمل"
        >
          <span className="avatar small">{initial}</span>
          <span>
            <strong>{user?.name?.split(" ").slice(0, 2).join(" ") ?? "—"}</strong>
            <small>{isDoctor ? "طبيب/ة" : "استقبال"}</small>
          </span>
          <Icon name="chevron" size={14} />
        </button>
      </div>
    </header>
  )
}

export function AppShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="app" dir="rtl">
      <Sidebar />
      <div className="main-shell">
        <Header title={title} />
        <main className="page">{children}</main>
      </div>
    </div>
  )
}
