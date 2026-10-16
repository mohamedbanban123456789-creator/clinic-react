/**
 * Supervision reports screen (doctor only) — new screen in the established
 * design language. Aggregates the backend supervision endpoints: cash
 * summary (design donut), shift history with variance, exceptions,
 * discounts, and the audit trail. Includes a Recharts revenue chart styled
 * with the design palette.
 */

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { useAuth } from "@/clinic/auth/AuthContext"
import { supervisionApi, auditApi } from "@/clinic/api/admin"
import { shiftsApi } from "@/clinic/api/shifts"
import { apiErrorMessage } from "@/clinic/api/client"
import { Icon, SkeletonBlock, StatCard, useToast } from "@/clinic/components/ui"
import { arDate, arNum, arDateTime, moneyMinor, arPercent } from "@/clinic/lib/format"
import { shiftResultLabel } from "@/clinic/lib/constants"

/* Glass-design chart palette (dark surfaces) */
const primary = "oklch(0.74 0.11 190)" // teal — donut/legend "نقدي" (primary cash)
const teal = "oklch(0.68 0.12 225)" // blue — donut/legend "أخرى"
const blue = "oklch(0.75 0.15 220)" // info — legend "عكس عمليات"

export default function ReportsScreen() {
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"
  const { notify } = useToast()
  const [tab, setTab] = useState<"cash" | "shifts" | "exceptions" | "audit">("cash")

  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => shiftsApi.current(),
  })
  const shiftsHistoryQuery = useQuery({
    queryKey: ["supervision", "shifts"],
    queryFn: () => supervisionApi.shifts({ limit: 30 }),
    enabled: isDoctor,
  })
  const exceptionsQuery = useQuery({
    queryKey: ["supervision", "exceptions"],
    queryFn: () => supervisionApi.exceptions(),
    enabled: isDoctor,
  })
  const unsignedQuery = useQuery({
    queryKey: ["supervision", "unsigned-notes"],
    queryFn: () => supervisionApi.unsignedNotes(),
    enabled: isDoctor,
  })
  const auditQuery = useQuery({
    queryKey: ["audit", "recent"],
    queryFn: () => auditApi.list({ limit: 100 }),
    enabled: isDoctor,
  })

  // Cash summary for the most recent CLOSED shift.
  const closedShifts = (shiftsHistoryQuery.data?.data ?? []).filter(
    (s) => s.status === "CLOSED",
  )
  const latestClosed = closedShifts[0]
  const cashSummaryQuery = useQuery({
    queryKey: ["supervision", "cash-summary", latestClosed?.shiftId ?? "none"],
    queryFn: () => supervisionApi.cashSummary(latestClosed!.shiftId),
    enabled: Boolean(isDoctor && latestClosed),
  })
  const discountsQuery = useQuery({
    queryKey: ["supervision", "discounts", latestClosed?.shiftId ?? "none"],
    queryFn: () => supervisionApi.discounts(latestClosed!.shiftId!),
    enabled: Boolean(isDoctor && latestClosed),
  })

  const cash = cashSummaryQuery.data
  const gross = cash ? cash.byMethod.CASH + cash.byMethod.OTHER : 0
  const cashPart = cash?.byMethod.CASH ?? 0
  const otherPart = cash?.byMethod.OTHER ?? 0
  const cashPct = gross > 0 ? (cashPart / gross) * 100 : 0

  const chartData = [...closedShifts]
    .reverse()
    .slice(-10)
    .map((s) => ({
      date: arDate(s.businessDate),
      expected: (s.expectedCashMinor ?? 0) / 100,
      actual: (s.actualCountedMinor ?? 0) / 100,
    }))

  const exceptions = exceptionsQuery.data
  const unacked = exceptions?.unacknowledgedEmergencies ?? []
  const unsignedNotes = unsignedQuery.data

  const auditRows = auditQuery.data?.data ?? []

  return (
    <>
      <section className="closing-top">
        <div>
          <span className="section-kicker">المساحة الإشرافية</span>
          <h2>تقارير الخزينة والتشغيل</h2>
          <p>ملخصات مالية رسمية للورديبات المقفلة وتنبيهات التشغيل.</p>
        </div>
        <div className="closing-status">
          <span className="live-dot" />
          <span>
            <small>حالة الوردية الحالية</small>
            <strong>
              {shiftQuery.data?.status === "OPEN" ? "مفتوحة" : "جارٍ التحديث..."}
            </strong>
          </span>
        </div>
      </section>

      <div className="tabs" style={{ marginBottom: "14px" }}>
        <button className={tab === "cash" ? "active" : ""} onClick={() => setTab("cash")}>
          ملخص الخزينة
        </button>
        <button className={tab === "shifts" ? "active" : ""} onClick={() => setTab("shifts")}>
          سجل الورديات
        </button>
        <button className={tab === "exceptions" ? "active" : ""} onClick={() => setTab("exceptions")}>
          الاستثناءات
        </button>
        <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}>
          سجل التدقيق
        </button>
      </div>

      {tab === "cash" && (
        <>
          {!latestClosed && (
            <section className="card">
              <div className="empty-state">
                <Icon name="chart" size={34} />
                <h3>لا وردية مقفلة بعد</h3>
                <p>ستظهر الملخصات الرسمية بعد أول إغلاق يومي.</p>
              </div>
            </section>
          )}
          {latestClosed && (
            <>
              <section className="stats-grid four">
                <StatCard
                  label="إجمالي محصل"
                  value={arNum(gross / 100)}
                  suffix="ج.م."
                  hint={`وردية ${arDate(latestClosed.businessDate)}`}
                  icon="wallet"
                  tone="mint"
                />
                <StatCard
                  label="نقدي"
                  value={arNum(cashPart / 100)}
                  suffix="ج.م."
                  hint={arPercent(cashPart, gross || 1)}
                  icon="banknote"
                  tone="teal"
                />
                <StatCard
                  label="مصروفات نثرية"
                  value={arNum((cash?.pettyExpenseMinor ?? 0) / 100)}
                  suffix="ج.م."
                  hint={`إيداعات: ${arNum((cash?.pettyInjectionMinor ?? 0) / 100)} ج.م.`}
                  icon="receipt"
                  tone="coral"
                />
                <StatCard
                  label="نتيجة المطابقة"
                  value={
                    cash?.result ? shiftResultLabel[cash.result] ?? cash.result : "—"
                  }
                  hint={
                    cash?.differenceMinor !== null && cash?.differenceMinor !== undefined
                      ? `فرق ${moneyMinor(Math.abs(cash.differenceMinor))}`
                      : "—"
                  }
                  icon="check"
                  tone={cash?.reconciliationPassed ? "mint" : "coral"}
                />
              </section>

              <section className="card report-chart">
                <div className="card-header">
                  <div>
                    <h3>توزيع الإيراد حسب طريقة الدفع</h3>
                    <p>آخر وردية مقفلة — {arDate(latestClosed.businessDate)}</p>
                  </div>
                </div>
                <div className="chart-body">
                  <div
                    className="donut"
                    style={{
                      background: `conic-gradient(${primary} 0 ${cashPct}%, ${teal} ${cashPct}% 100%)`,
                    }}
                  >
                    <div>
                      <strong>{arNum(gross / 100)}</strong>
                      <small>ج.م.</small>
                    </div>
                  </div>
                  <div className="chart-legend">
                    <span>
                      <i className="legend-indigo" />
                      <b>نقدي</b>
                      <small>{moneyMinor(cashPart)}</small>
                      <em>{arPercent(cashPart, gross || 1)}</em>
                    </span>
                    <span>
                      <i className="legend-teal" />
                      <b>أخرى (إلكتروني)</b>
                      <small>{moneyMinor(otherPart)}</small>
                      <em>{arPercent(otherPart, gross || 1)}</em>
                    </span>
                    <span>
                      <i className="legend-blue" />
                      <b>عكس عمليات</b>
                      <small>{moneyMinor(cash?.reversalsMinor ?? 0)}</small>
                      <em>—</em>
                    </span>
                  </div>
                </div>
              </section>

              {(discountsQuery.data?.count ?? 0) > 0 && (
                <section className="card archive-card">
                  <div className="card-header">
                    <div>
                      <span className="section-kicker">رقابة الخصومات</span>
                      <h3>
                        خصومات الوردية ({arNum(discountsQuery.data?.count ?? 0)})
                      </h3>
                    </div>
                  </div>
                  <div className="data-table">
                    <div className="data-head">
                      <span>الفاتورة</span>
                      <span>الأساسي</span>
                      <span>النهائي</span>
                      <span>الخصم</span>
                      <span>السبب</span>
                      <span>بواسطة</span>
                    </div>
                    {(discountsQuery.data?.data ?? []).map((d) => (
                      <div className="data-row" key={d.invoiceId} style={{ cursor: "default" }}>
                        <strong>{d.invoiceId.slice(-6).toUpperCase()}</strong>
                        <span>{moneyMinor(d.standardFeeMinor)}</span>
                        <span>{moneyMinor(d.finalFeeMinor)}</span>
                        <span className="due-text">{moneyMinor(d.discountMinor)}</span>
                        <span>{d.discountReason ?? (d.isComplimentary ? "استشارة مجانية" : "—")}</span>
                        <span>
                          {d.authorName} ({d.authorRole === "DOCTOR" ? "طبيب" : "استقبال"})
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </>
      )}

      {tab === "shifts" && (
        <section className="card archive-card">
          <div className="card-header">
            <div>
              <span className="section-kicker">سجل الورديات</span>
              <h3>آخر {arNum(closedShifts.length)} وردية مقفلة</h3>
            </div>
          </div>
          {chartData.length >= 2 && (
            <div style={{ height: "240px", direction: "ltr", marginBottom: "18px" }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="rgba(255,255,255,0.09)" strokeDasharray="4 6" />
                  <XAxis dataKey="date" tick={{ fontSize: 12, fill: "rgba(255,255,255,0.68)" }} stroke="rgba(255,255,255,0.28)" />
                  <YAxis tick={{ fontSize: 12, fill: "rgba(255,255,255,0.68)" }} stroke="rgba(255,255,255,0.28)" width={48} />
                  <Tooltip
                    contentStyle={{
                      fontFamily: '"IBM Plex Sans Arabic", system-ui, sans-serif',
                      fontSize: 13,
                      direction: "rtl",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.28)",
                      background: "oklch(0.3 0.04 280 / 0.95)",
                      color: "#fff",
                      boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
                    }}
                    labelStyle={{ color: "rgba(255,255,255,0.72)", fontWeight: 700, marginBottom: 4 }}
                    itemStyle={{ color: "#fff" }}
                    cursor={{ stroke: "rgba(255,255,255,0.3)", strokeDasharray: "4 4" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="expected"
                    name="المتوقع"
                    stroke="#ffffff"
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    dot={false}
                    activeDot={{ r: 5, fill: "#fff", stroke: primary, strokeWidth: 3 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="actual"
                    name="الفعلي"
                    stroke={teal}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    dot={false}
                    activeDot={{ r: 5, fill: teal, stroke: "#0e2a2e", strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="data-table">
            <div className="data-head">
              <span>التاريخ</span>
              <span>المتوقع</span>
              <span>الفعلي</span>
              <span>الفرق</span>
              <span>النتيجة</span>
              <span>المراجعة</span>
            </div>
            {shiftsHistoryQuery.isLoading && <SkeletonBlock lines={3} />}
            {closedShifts.length === 0 && !shiftsHistoryQuery.isLoading && (
              <div className="data-row">
                <span>لا ورديات مقفلة بعد.</span>
              </div>
            )}
            {closedShifts.map((s) => (
              <div className="data-row" key={s.shiftId} style={{ cursor: "default" }}>
                <strong>{arDate(s.businessDate)}</strong>
                <span>{moneyMinor(s.expectedCashMinor ?? 0)}</span>
                <span>{moneyMinor(s.actualCountedMinor ?? 0)}</span>
                <span className={(s.differenceMinor ?? 0) !== 0 ? "due-text" : ""}>
                  {moneyMinor(Math.abs(s.differenceMinor ?? 0))}
                </span>
                <span className="method-pill">
                  {s.result ? shiftResultLabel[s.result] ?? s.result : "—"}
                </span>
                <span>{s.reviewedAt ? arDate(s.reviewedAt) : "بانتظار المراجعة"}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "exceptions" && (
        <section className="card archive-card">
          <div className="card-header">
            <div>
              <span className="section-kicker">تنبيهات التشغيل</span>
              <h3>استثناءات الوردية</h3>
            </div>
          </div>
          <div className="data-table">
            <div className="data-head">
              <span>النوع</span>
              <span>التفاصيل</span>
              <span>الوقت</span>
            </div>
            {unacked.length === 0 && (
              <div className="data-row">
                <span>لا استثناءات غير معتمدة.</span>
              </div>
            )}
            {unacked.map((e) => (
              <div className="data-row" key={e.queueEntryId} style={{ cursor: "default" }}>
                <strong>طارئ غير مُعتمد</strong>
                <span>
                  مريض {e.patientId.slice(-6)} · {e.reasonCode}
                </span>
                <span>{arDateTime(e.flaggedAt)}</span>
              </div>
            ))}
            {(unsignedNotes?.completedWithoutSigned ?? [])
              .filter((c) => !c.hasSignedEncounter)
              .map((c) => (
                <div className="data-row" key={c.queueEntryId} style={{ cursor: "default" }}>
                  <strong>زيارة بدون توثيق</strong>
                  <span>{c.displayName}</span>
                  <span>{arDateTime(c.completedAt)}</span>
                </div>
              ))}
            {(unsignedNotes?.staleDrafts ?? []).map((d) => (
              <div className="data-row" key={d.draftId} style={{ cursor: "default" }}>
                <strong>{d.draftKind === "SCRIBE" ? "جلسة AI معلقة" : "مسودة تقرير قديمة"}</strong>
                <span>
                  مريض {d.patientId.slice(-6)} · عمرها {arNum(Math.round(d.ageHours))} ساعة
                </span>
                <span>{arDateTime(d.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "audit" && (
        <section className="card archive-card">
          <div className="card-header">
            <div>
              <span className="section-kicker">سجل التدقيق</span>
              <h3>آخر {arNum(auditRows.length)} حدثًا</h3>
              <p>يُعرض للطبيب السجل الكامل، ولاستقبال أحداثه التشغيلية فقط.</p>
            </div>
          </div>
          <div className="data-table">
            <div className="data-head">
              <span>الحدث</span>
              <span>الكيان</span>
              <span>الوقت</span>
              <span>ملاحظة</span>
            </div>
            {auditQuery.isLoading && <SkeletonBlock lines={4} />}
            {auditRows.map((a) => (
              <div className="data-row" key={a.id} style={{ cursor: "default" }}>
                <strong>{a.action}</strong>
                <span>
                  {a.entityType} · {a.entityId.slice(-6)}
                </span>
                <span>{arDateTime(a.createdAt)}</span>
                <span>{a.reasonText ?? "—"}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
