import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Search, LayoutGrid, CalendarDays, Users, Wallet, Bell, Settings,
  Stethoscope, ChevronDown, ChevronLeft, ChevronRight, Plus, Clock,
  Video, Phone, CheckCircle2, MoreHorizontal,
} from "lucide-react";

export const Route = createFileRoute("/appointments")({
  head: () => ({
    meta: [
      { title: "المواعيد — عيادة سكينة للطب النفسي" },
      { name: "description", content: "جدول مواعيد اليوم والأسبوع في واجهة زجاجية شفافة." },
      { property: "og:title", content: "المواعيد — عيادة سكينة" },
      { property: "og:description", content: "إدارة مواعيد المرضى اليومية والأسبوعية." },
    ],
  }),
  component: AppointmentsPage,
});

const nav = [
  { icon: LayoutGrid, label: "الرئيسية", to: "/" },
  { icon: CalendarDays, label: "المواعيد", to: "/appointments" },
  { icon: Users, label: "المرضى", to: "/" },
  { icon: Wallet, label: "الخزينة", to: "/" },
  { icon: Settings, label: "الإعدادات", to: "/" },
];

const days = [
  { d: "السبت", n: "١٧" }, { d: "الأحد", n: "١٨" }, { d: "الاثنين", n: "١٩" },
  { d: "الثلاثاء", n: "٢٠" }, { d: "الأربعاء", n: "٢١" }, { d: "الخميس", n: "٢٢" },
  { d: "الجمعة", n: "١٦", today: true },
];

const appointments = [
  { time: "٠٩:٠٠", name: "ليلى حسن", type: "جلسة متابعة", mode: "حضوري", icon: CheckCircle2, tint: "oklch(0.8 0.15 160)", done: true },
  { time: "٠٩:٣٠", name: "سارة محمود", type: "جلسة علاج معرفي", mode: "حضوري", icon: Clock, tint: "oklch(0.75 0.15 220)", done: true },
  { time: "١٠:٠٠", name: "منى عبد الله", type: "استشارة أولى", mode: "حضوري", icon: Clock, tint: "oklch(0.8 0.15 90)" },
  { time: "١٠:٣٠", name: "كريم فؤاد", type: "جلسة متابعة", mode: "مكالمة فيديو", icon: Video, tint: "oklch(0.72 0.19 290)" },
  { time: "١١:٠٠", name: "هبة سامي", type: "تقييم دوائي", mode: "مكالمة هاتفية", icon: Phone, tint: "oklch(0.72 0.17 340)" },
  { time: "١١:٣٠", name: "عمر طارق", type: "جلسة علاج جماعي", mode: "حضوري", icon: Clock, tint: "oklch(0.78 0.14 180)" },
];

function Glass({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-[1.75rem] border border-white/30 bg-white/15 shadow-[inset_0_1px_0_oklch(1_0_0/0.35),0_12px_40px_oklch(0_0_0/0.12)] backdrop-blur-2xl ${className}`}
    >
      {children}
    </div>
  );
}

function AppointmentsPage() {
  const [active, setActive] = useState(1);

  return (
    <div
      dir="rtl"
      className="relative min-h-screen overflow-hidden text-white"
      style={{
        background:
          "radial-gradient(1000px 600px at 80% 0%, oklch(0.65 0.2 310 / 0.85), transparent 60%)," +
          "radial-gradient(800px 600px at 0% 100%, oklch(0.6 0.18 250 / 0.8), transparent 60%)," +
          "radial-gradient(600px 500px at 40% 110%, oklch(0.65 0.15 190 / 0.55), transparent 60%)," +
          "linear-gradient(140deg, oklch(0.5 0.15 295), oklch(0.42 0.13 265) 50%, oklch(0.48 0.14 225))",
      }}
    >
      {/* floating glass orbs */}
      <div className="pointer-events-none absolute -left-24 top-32 h-72 w-72 rounded-full border border-white/20 bg-white/10 blur-2xl" />
      <div className="pointer-events-none absolute bottom-24 right-1/3 h-56 w-56 rounded-full border border-white/20 bg-white/10 blur-2xl" />

      <div className="relative mx-auto flex max-w-[1440px] gap-6 p-6">
        {/* Sidebar */}
        <Glass className="sticky top-6 flex h-[calc(100vh-3rem)] w-56 shrink-0 flex-col p-5">
          <div className="flex items-center gap-3 px-1">
            <div className="grid h-10 w-10 place-items-center rounded-2xl border border-white/30 bg-white/20">
              <Stethoscope className="h-5 w-5" />
            </div>
            <p className="text-lg font-bold tracking-wide">سكينة</p>
          </div>
          <nav className="mt-8 flex-1 space-y-1.5">
            {nav.map((it, i) => (
              <Link
                key={it.label}
                to={it.to}
                onClick={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-sm transition ${
                  active === i
                    ? "border-white/40 bg-white/25 font-semibold shadow-[inset_0_1px_0_oklch(1_0_0/0.4)]"
                    : "border-transparent text-white/70 hover:bg-white/10"
                }`}
              >
                <it.icon className="h-5 w-5" strokeWidth={1.7} />
                {it.label}
              </Link>
            ))}
          </nav>
          <button className="flex items-center gap-3 rounded-2xl border border-white/25 bg-white/15 p-3 text-right transition hover:bg-white/25">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/30 text-sm font-bold">ن</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">نور الهدى</p>
              <p className="truncate text-xs text-white/60">سكرتيرة الاستقبال</p>
            </div>
            <ChevronDown className="h-4 w-4 text-white/60" />
          </button>
        </Glass>

        {/* Main */}
        <main className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">المواعيد 📅</h1>
              <p className="mt-1 text-sm text-white/65">الجمعة ١٦ أكتوبر · ٦ مواعيد اليوم</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-2xl border border-white/30 bg-white/15 px-4 py-2.5 backdrop-blur-2xl">
                <Search className="h-4 w-4 text-white/60" />
                <input placeholder="ابحث عن مريض..." className="w-40 bg-transparent text-sm outline-none placeholder:text-white/50" />
              </div>
              <button className="relative grid h-11 w-11 place-items-center rounded-2xl border border-white/30 bg-white/15 backdrop-blur-2xl transition hover:bg-white/25">
                <Bell className="h-5 w-5" />
                <span className="absolute left-2.5 top-2.5 h-2 w-2 rounded-full bg-rose-300" />
              </button>
            </div>
          </div>

          {/* Week strip */}
          <Glass className="mt-6 flex items-center gap-2 p-4">
            <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/25 bg-white/10 transition hover:bg-white/25">
              <ChevronRight className="h-4 w-4" />
            </button>
            <div className="grid flex-1 grid-cols-7 gap-2">
              {days.map((d) => (
                <button
                  key={d.d}
                  className={`rounded-2xl border py-3 text-center transition ${
                    d.today
                      ? "border-white/50 bg-white/30 shadow-[inset_0_1px_0_oklch(1_0_0/0.5)]"
                      : "border-white/15 bg-white/5 hover:bg-white/15"
                  }`}
                >
                  <p className="text-xs text-white/65">{d.d}</p>
                  <p className="mt-0.5 text-lg font-bold">{d.n}</p>
                </button>
              ))}
            </div>
            <button className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-white/25 bg-white/10 transition hover:bg-white/25">
              <ChevronLeft className="h-4 w-4" />
            </button>
          </Glass>

          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            {/* Schedule */}
            <Glass className="p-6 xl:col-span-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">جدول اليوم</p>
                <button className="flex items-center gap-1.5 rounded-full border border-white/30 bg-white/15 px-4 py-1.5 text-xs font-medium transition hover:bg-white/25">
                  <Plus className="h-3.5 w-3.5" /> موعد جديد
                </button>
              </div>
              <ul className="mt-5 space-y-3">
                {appointments.map((a) => (
                  <li
                    key={a.time}
                    className={`flex items-center gap-4 rounded-2xl border border-white/20 bg-white/10 px-4 py-3.5 backdrop-blur-xl transition hover:bg-white/20 ${a.done ? "opacity-60" : ""}`}
                  >
                    <div className="w-12 text-center">
                      <p className="text-sm font-bold">{a.time}</p>
                    </div>
                    <div className="h-10 w-px bg-white/20" />
                    <div
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/25"
                      style={{ background: `color-mix(in oklab, ${a.tint} 35%, transparent)` }}
                    >
                      <a.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{a.name}</p>
                      <p className="text-xs text-white/60">{a.type} · {a.mode}</p>
                    </div>
                    {a.done && <span className="rounded-full bg-emerald-300/25 px-3 py-1 text-xs text-emerald-200">تمت</span>}
                    <MoreHorizontal className="h-4 w-4 text-white/50" />
                  </li>
                ))}
              </ul>
            </Glass>

            {/* Side widgets */}
            <div className="space-y-5">
              <Glass className="p-6">
                <p className="font-semibold">ملخص اليوم</p>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {[
                    { l: "إجمالي", v: "٦" },
                    { l: "تمت", v: "٢" },
                    { l: "متبقية", v: "٤" },
                    { l: "أونلاين", v: "٢" },
                  ].map((x) => (
                    <div key={x.l} className="rounded-2xl border border-white/20 bg-white/10 p-3 text-center backdrop-blur-xl">
                      <p className="text-2xl font-bold">{x.v}</p>
                      <p className="text-xs text-white/60">{x.l}</p>
                    </div>
                  ))}
                </div>
              </Glass>
              <Glass className="p-6">
                <p className="font-semibold">الموعد التالي</p>
                <div className="mt-4 rounded-2xl border border-white/25 bg-white/15 p-4 backdrop-blur-xl">
                  <p className="text-lg font-bold">منى عبد الله</p>
                  <p className="mt-1 text-sm text-white/65">استشارة أولى · ١٠:٠٠ ص</p>
                  <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
                    <Clock className="h-3.5 w-3.5" /> بعد ٢٥ دقيقة
                  </div>
                </div>
                <button className="mt-4 w-full rounded-2xl border border-white/40 bg-white/85 py-3 text-sm font-bold text-[oklch(0.4_0.13_275)] transition hover:bg-white">
                  تسجيل الوصول
                </button>
              </Glass>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
