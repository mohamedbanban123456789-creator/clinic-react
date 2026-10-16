import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Search, LayoutGrid, CalendarDays, Users, Wallet, Bell, Settings,
  Stethoscope, UserPlus, Siren, Receipt, ChevronDown, CheckCircle2,
  TrendingUp, TrendingDown, Clock, ListChecks, MoreHorizontal, Plus,
} from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "مكتب الاستقبال — عيادة سكينة للطب النفسي" },
      { name: "description", content: "لوحة الاستقبال: طابور الانتظار، الوردية المالية، والمهام في واجهة زجاجية هادئة." },
      { property: "og:title", content: "مكتب الاستقبال — عيادة سكينة" },
      { property: "og:description", content: "إدارة طابور الانتظار والدفع والمتابعات بهدوء ووضوح." },
    ],
  }),
  component: DeskHome,
});

const nav = [
  { icon: LayoutGrid, label: "الرئيسية" },
  { icon: CalendarDays, label: "المواعيد" },
  { icon: Users, label: "المرضى" },
  { icon: Wallet, label: "الخزينة" },
  { icon: ListChecks, label: "المتابعات" },
  { icon: Settings, label: "الإعدادات" },
];

const stats = [
  { icon: Wallet, label: "محصّل اليوم", value: "٣٬٤٥٠ ج.م", delta: "↑ ١٢٫٥٪ عن أمس", up: true, tint: "oklch(0.72 0.19 290)" },
  { icon: Users, label: "مرضى اليوم", value: "٢٨", delta: "↑ ٨٫١٪ عن أمس", up: true, tint: "oklch(0.75 0.15 220)" },
  { icon: Clock, label: "في الانتظار", value: "٥", delta: "↑ ٣ عن المعتاد", up: true, tint: "oklch(0.78 0.14 180)" },
  { icon: Receipt, label: "مديونيات", value: "٦٠٠ ج.م", delta: "↓ ٢٫٤٪ عن أمس", up: false, tint: "oklch(0.72 0.17 340)" },
];

const queue = [
  { name: "سارة محمود", detail: "مع الطبيب · داخل منذ ١٢ د", pct: "٩:٣٠", color: "oklch(0.75 0.15 160)" },
  { name: "أحمد الشريف", detail: "حالة طارئة", pct: "٩:٤٥", color: "oklch(0.7 0.2 25)" },
  { name: "منى عبد الله", detail: "ينتظر ١٨ دقيقة", pct: "١٠:٠٠", color: "oklch(0.8 0.15 90)" },
  { name: "كريم فؤاد", detail: "ينتظر ٦ دقائق", pct: "١٠:١٥", color: "oklch(0.75 0.15 220)" },
];

const notifications = [
  { icon: CheckCircle2, title: "اكتملت جلسة سارة محمود", time: "منذ ساعتين", tint: "oklch(0.78 0.14 180)" },
  { icon: UserPlus, title: "تسجيل مريض جديد", time: "منذ ٥ ساعات", tint: "oklch(0.72 0.19 290)" },
];

// Revenue chart path (viewBox 0 0 640 220)
const line = "M0,190 C40,170 60,120 100,130 C140,140 160,180 200,165 C240,150 260,80 300,70 C340,60 360,110 400,105 C440,100 460,140 500,130 C540,120 560,70 600,55 L640,45";
const area = `${line} L640,220 L0,220 Z`;

function Glass({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`rounded-3xl border border-white/15 bg-white/10 shadow-[0_8px_32px_oklch(0_0_0/0.15)] backdrop-blur-xl ${className}`}
    >
      {children}
    </div>
  );
}

function DeskHome() {
  const [active, setActive] = useState(0);

  return (
    <div
      dir="rtl"
      className="min-h-screen text-white"
      style={{
        background:
          "radial-gradient(1200px 700px at 85% -10%, oklch(0.55 0.2 300 / 0.9), transparent 60%)," +
          "radial-gradient(900px 600px at -10% 110%, oklch(0.5 0.18 270 / 0.8), transparent 60%)," +
          "radial-gradient(700px 500px at 50% 120%, oklch(0.55 0.15 210 / 0.6), transparent 60%)," +
          "linear-gradient(135deg, oklch(0.42 0.14 290), oklch(0.35 0.12 265) 55%, oklch(0.4 0.13 230))",
      }}
    >
      <div className="mx-auto flex max-w-[1440px] gap-6 p-6">
        {/* Sidebar */}
        <Glass className="sticky top-6 flex h-[calc(100vh-3rem)] w-56 shrink-0 flex-col p-5">
          <div className="flex items-center gap-3 px-1">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-white/15">
              <Stethoscope className="h-5 w-5" />
            </div>
            <p className="text-lg font-bold tracking-wide">سكينة</p>
          </div>
          <nav className="mt-8 flex-1 space-y-1.5">
            {nav.map((it, i) => (
              <button
                key={it.label}
                onClick={() => setActive(i)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm transition ${
                  active === i ? "bg-white/20 font-semibold shadow-inner" : "text-white/70 hover:bg-white/10"
                }`}
              >
                <it.icon className="h-5 w-5" strokeWidth={1.7} />
                {it.label}
              </button>
            ))}
          </nav>
          <button className="flex items-center gap-3 rounded-2xl bg-white/10 p-3 text-right transition hover:bg-white/15">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/25 text-sm font-bold">ن</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">نور الهدى</p>
              <p className="truncate text-xs text-white/60">سكرتيرة الاستقبال</p>
            </div>
            <ChevronDown className="h-4 w-4 text-white/60" />
          </button>
        </Glass>

        {/* Main */}
        <main className="min-w-0 flex-1">
          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">صباح الخير، نور 👋</h1>
              <p className="mt-1 text-sm text-white/60">إليك ما يحدث في العيادة اليوم.</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded-2xl border border-white/15 bg-white/10 px-4 py-2.5 backdrop-blur-xl">
                <Search className="h-4 w-4 text-white/60" />
                <input
                  placeholder="بحث..."
                  className="w-44 bg-transparent text-sm outline-none placeholder:text-white/50"
                />
              </div>
              <button className="relative grid h-11 w-11 place-items-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl transition hover:bg-white/20">
                <Bell className="h-5 w-5" />
                <span className="absolute left-2.5 top-2.5 h-2 w-2 rounded-full bg-rose-400" />
              </button>
              <button className="grid h-11 w-11 place-items-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-xl transition hover:bg-white/20">
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Stat cards */}
          <div className="mt-6 grid grid-cols-2 gap-5 xl:grid-cols-4">
            {stats.map((s) => (
              <Glass key={s.label} className="p-5">
                <div className="flex items-center gap-3">
                  <div
                    className="grid h-11 w-11 place-items-center rounded-full"
                    style={{ background: `color-mix(in oklab, ${s.tint} 45%, transparent)` }}
                  >
                    <s.icon className="h-5 w-5" />
                  </div>
                  <p className="text-sm text-white/70">{s.label}</p>
                </div>
                <p className="mt-3 text-3xl font-bold">{s.value}</p>
                <p className={`mt-1 flex items-center gap-1 text-xs ${s.up ? "text-emerald-300" : "text-rose-300"}`}>
                  {s.up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                  {s.delta}
                </p>
              </Glass>
            ))}
          </div>

          {/* Chart + queue */}
          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            <Glass className="p-6 xl:col-span-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">إيرادات الأسبوع</p>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-white/70">هذا الأسبوع</span>
                  <MoreHorizontal className="h-4 w-4 text-white/60" />
                </div>
              </div>
              <div className="mt-2 flex items-baseline gap-3">
                <p className="text-3xl font-bold">١٨٬٢٤٠ ج.م</p>
                <span className="flex items-center gap-1 text-sm text-emerald-300"><TrendingUp className="h-4 w-4" /> ١٢٫٥٪</span>
              </div>
              <svg viewBox="0 0 640 220" className="mt-4 w-full">
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="oklch(0.85 0.12 220)" stopOpacity="0.45" />
                    <stop offset="100%" stopColor="oklch(0.85 0.12 220)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {[40, 90, 140, 190].map((y) => (
                  <line key={y} x1="0" y1={y} x2="640" y2={y} stroke="white" strokeOpacity="0.08" strokeDasharray="4 6" />
                ))}
                <path d={area} fill="url(#areaFill)" />
                <path d={line} fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                <circle cx="400" cy="105" r="6" fill="white" stroke="oklch(0.45 0.15 280)" strokeWidth="3" />
              </svg>
              <div className="mt-1 flex justify-between text-xs text-white/50">
                {["السبت", "الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة"].map((d) => <span key={d}>{d}</span>)}
              </div>
            </Glass>

            {/* Queue donut */}
            <Glass className="p-6">
              <div className="flex items-center justify-between">
                <p className="font-semibold">طابور الانتظار</p>
                <MoreHorizontal className="h-4 w-4 text-white/60" />
              </div>
              <div className="relative mx-auto mt-5 h-36 w-36">
                <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="white" strokeOpacity="0.12" strokeWidth="12" />
                  <circle
                    cx="60" cy="60" r="50" fill="none" stroke="url(#donut)" strokeWidth="12" strokeLinecap="round"
                    strokeDasharray={`${0.72 * 2 * Math.PI * 50} ${2 * Math.PI * 50}`}
                  />
                  <defs>
                    <linearGradient id="donut" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="oklch(0.8 0.15 200)" />
                      <stop offset="100%" stopColor="oklch(0.72 0.19 290)" />
                    </linearGradient>
                  </defs>
                </svg>
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <p className="text-2xl font-bold">٧٢٪</p>
                    <p className="text-xs text-white/60">من مواعيد اليوم</p>
                  </div>
                </div>
              </div>
              <ul className="mt-5 space-y-2.5 text-sm">
                {queue.map((q) => (
                  <li key={q.name} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: q.color }} />
                    <span className="flex-1 truncate">{q.name}</span>
                    <span className="text-white/60">{q.pct}</span>
                  </li>
                ))}
              </ul>
            </Glass>
          </div>

          {/* Bottom row */}
          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            <Glass className="p-6 xl:col-span-2">
              <div className="flex items-center justify-between">
                <p className="font-semibold">حالة النظام</p>
                <span className="text-xs text-emerald-300">كل الأنظمة تعمل</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
                {[
                  { label: "المزامنة", val: "منذ ثوانٍ" },
                  { label: "الطابعة", val: "جاهزة" },
                  { label: "النسخ الاحتياطي", val: "مكتمل" },
                ].map((x) => (
                  <div key={x.label} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    <div>
                      <p className="font-medium">{x.label}</p>
                      <p className="text-xs text-emerald-300">{x.val}</p>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex gap-3">
                <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-white/90 py-3 text-sm font-bold text-[oklch(0.35_0.12_280)] transition hover:bg-white">
                  <UserPlus className="h-4 w-4" /> تسجيل وصول
                </button>
                <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl border border-rose-300/40 bg-rose-400/20 py-3 text-sm font-bold text-rose-200 transition hover:bg-rose-400/30">
                  <Siren className="h-4 w-4" /> استقبال طارئ
                </button>
              </div>
            </Glass>

            <Glass className="p-6">
              <div className="flex items-center justify-between">
                <p className="font-semibold">الإشعارات</p>
                <button className="text-xs text-white/60 hover:text-white">عرض الكل</button>
              </div>
              <ul className="mt-4 space-y-3">
                {notifications.map((n) => (
                  <li key={n.title} className="flex items-center gap-3">
                    <div
                      className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl"
                      style={{ background: `color-mix(in oklab, ${n.tint} 40%, transparent)` }}
                    >
                      <n.icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-white/50">{n.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Glass>
          </div>
        </main>
      </div>
    </div>
  );
}
