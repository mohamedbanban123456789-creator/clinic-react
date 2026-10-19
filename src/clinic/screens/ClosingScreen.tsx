/**
 * Daily closing — design preserved, mapped to the real blind-cash contract:
 *  - Open shift (POST /shifts/open) with a blind physical opening count.
 *  - Petty expenses/injections (POST /shifts/:id/petty).
 *  - Reconciliation: expected cash stays hidden while OPEN (server rule);
 *    entering the actual count + closing reveals expected/difference/result.
 *  - Post-close: full summary, payment-method donut, and doctor review/ack.
 */

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { listStagger, rise } from "@/clinic/motion"
import { shiftsApi } from "@/clinic/api/shifts"
import { supervisionApi } from "@/clinic/api/admin"
import { useShiftInvoices } from "@/clinic/hooks/useShiftInvoices"
import { apiErrorMessage, ApiError } from "@/clinic/api/client"
import { AppButton, Icon, Modal, StatCard, useToast } from "@/clinic/components/ui"
import { useAuth } from "@/clinic/auth/AuthContext"
import { useQueue } from "@/clinic/hooks/useQueue"
import { arNum, arDate, arTime, moneyMinor, arPercent } from "@/clinic/lib/format"
import { pettyDirectionLabel, shiftResultLabel } from "@/clinic/lib/constants"
import type { CloseShiftDto } from "@/clinic/api/types"

function AddPettyModal({
  shiftId,
  onClose,
}: {
  shiftId: string
  onClose: () => void
}) {
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    direction: "EXPENSE",
    category: "",
    description: "",
    amount: "",
  })

  const mutation = useMutation({
    mutationFn: () =>
      shiftsApi.addPetty(shiftId, {
        amountMinor: Math.round(Number(form.amount) * 100),
        direction: form.direction as "EXPENSE" | "INJECTION",
        category: form.category.trim() || "تشغيلي",
        description: form.description.trim(),
      }),
    onSuccess: (petty) => {
      notify(`تم تسجيل ${pettyDirectionLabel[petty.direction]} بقيمة ${moneyMinor(petty.amountMinor)}`)
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
      onClose()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  return (
    <Modal
      title="إضافة مصروف / إيداع نثري"
      subtitle="يُسجل البند في سجل اليوم."
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (Number(form.amount) > 0 && form.description.trim()) mutation.mutate()
        }}
      >
        <div className="form-row">
          <label className="field">
            <span>النوع</span>
            <select
              value={form.direction}
              onChange={(e) => setForm({ ...form, direction: e.target.value })}
            >
              <option value="EXPENSE">مصروف</option>
              <option value="INJECTION">إيداع نقدي</option>
            </select>
          </label>
          <label className="field money-field">
            <span>المبلغ</span>
            <input
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <i>ج.م.</i>
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>الفئة</span>
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="مثال: مستلزمات مكتبية"
            />
          </label>
          <label className="field">
            <span>الوصف</span>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="وصف قصير للبند"
            />
          </label>
        </div>
        <div className="modal-actions">
          <AppButton variant="outline" type="button" onClick={onClose}>
            إلغاء
          </AppButton>
          <AppButton
            type="submit"
            icon="plus"
            disabled={mutation.isPending || Number(form.amount) <= 0 || !form.description.trim()}
          >
            {mutation.isPending ? "جارٍ الحفظ..." : "تسجيل البند"}
          </AppButton>
        </div>
      </form>
    </Modal>
  )
}

export default function ClosingScreen() {
  const { notify } = useToast()
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"
  const queryClient = useQueryClient()

  const [actual, setActual] = useState(0)
  const [showAddPetty, setShowAddPetty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmAck, setConfirmAck] = useState(false)
  const [closeReason, setCloseReason] = useState("")
  const [closeResult, setCloseResult] = useState<CloseShiftDto | null>(null)

  const { entries: queueEntries } = useQueue()
  const waitingPatients = useMemo(
    () => (queueEntries ?? []).filter((e) => e.status === "WAITING" || e.status === "IN_CONSULTATION"),
    [queueEntries],
  )

  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => shiftsApi.current(),
    refetchInterval: 60_000,
  })

  // Latest closed shift for the post-close report (fallback when just closed).
  // Supervision feeds are DOCTOR-only; secretaries see the open-shift form.
  const closedShiftsQuery = useQuery({
    queryKey: ["supervision", "shifts"],
    queryFn: () => supervisionApi.shifts({ limit: 10 }),
    enabled: isDoctor,
  })

  // Doctor post-close view: latest CLOSED shift (from the supervision feed)
  // when no live shift exists — enables review/ack on a fresh page load.
  const latestClosed = isDoctor
    ? (closedShiftsQuery.data?.data ?? []).find(
        (s) => s.status === "CLOSED" && s.reviewedAt === null,
      ) ?? (closedShiftsQuery.data?.data ?? []).find((s) => s.status === "CLOSED")
    : undefined

  const current = shiftQuery.data
  // Workday auto-opens silently (AutoWorkday in the shared shell) — this
  // screen only reports and closes; there is no manual open step anymore.
  const isOpen = current ? current.status === "OPEN" : !closeResult && !latestClosed

  // Report shiftId: live shift, or the just-closed one (after close,
  // GET /shifts/current 404s — "No open shift").
  const reportShiftId = current?.shiftId ?? closeResult?.shiftId ?? latestClosed?.shiftId

  const pettyQuery = useQuery({
    queryKey: ["shifts", "petty", reportShiftId ?? "none"],
    queryFn: () => shiftsApi.pettyList(reportShiftId!),
    enabled: Boolean(reportShiftId),
  })

  const invoicesQuery = useShiftInvoices(reportShiftId)

  const summaryQuery = useQuery({
    queryKey: ["shifts", "summary", reportShiftId ?? "none"],
    queryFn: () => shiftsApi.summary(reportShiftId!),
    enabled: Boolean(reportShiftId),
  })

  useEffect(() => {
    if (closeResult) {
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
    }
  }, [closeResult, queryClient])

  const reopenMutation = useMutation({
    mutationFn: () => shiftsApi.reopen(reportShiftId),
    onSuccess: () => {
      setCloseResult(null)
      notify("تمت إعادة فتح اليوم بنجاح")
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
      void queryClient.invalidateQueries({ queryKey: ["queue"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const closeMutation = useMutation({
    mutationFn: () => {
      const reason = closeReason.trim()
      const hasWaiting = waitingPatients.length > 0
      return shiftsApi.close(reportShiftId || "current", Math.round(actual * 100), {
        force: hasWaiting || reason.length > 0,
        ...(reason ? { forceReason: reason, reason } : {}),
      })
    },
    onSuccess: (result) => {
      setCloseResult(result)
      setConfirmClose(false)
      notify("تم إغلاق الخزينة وحفظ تقرير اليوم")
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
      void queryClient.invalidateQueries({ queryKey: ["receipts"] })
      void queryClient.invalidateQueries({ queryKey: ["queue"] })
    },
    onError: (err) => {
      notify(apiErrorMessage(err), "error")
    },
  })

  const ackMutation = useMutation({
    mutationFn: (note: string) => supervisionApi.ackShift(reportShiftId!, note || undefined),
    onSuccess: () => {
      notify("تم اعتماد مراجعة اليوم")
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  /* ----------------------- Live aggregates ----------------------- */

  const aggregates = useMemo(() => {
    const invoices = invoicesQuery.invoices ?? []
    const collected = invoices.reduce((s, i) => s + i.collectedMinor, 0)
    const served = invoices.length
    const pettyRows = pettyQuery.data?.data ?? []
    const pettyTotal = pettyRows.reduce((s, p) => s + p.amountMinor, 0)
    return { collected, served, pettyTotal, pettyRows }
  }, [invoicesQuery.invoices, pettyQuery.data])

  // Report shift view: live shift, or a GET /shifts/:id fetch for the
  // just-closed one (businessDate and post-close figures).
  const reportShiftQuery = useQuery({
    queryKey: ["shifts", "report", reportShiftId ?? "none"],
    queryFn: () => shiftsApi.get(reportShiftId!),
    enabled: !current && Boolean(reportShiftId),
  })
  const reportShift = current ?? reportShiftQuery.data
  const businessDate = reportShift?.businessDate ?? new Date().toISOString()

  const closeReportFrom = (
    s: typeof current,
  ): CloseShiftDto | null =>
    !isOpen && s && s.status === "CLOSED"
      ? {
          shiftId: s.shiftId,
          status: "CLOSED",
          expectedCashMinor: s.expectedCashMinor ?? 0,
          actualCountedMinor: s.actualCountedMinor ?? 0,
          differenceMinor: s.differenceMinor ?? 0,
          result: s.result ?? "BALANCED",
          integrityCheckPassed: s.integrityCheckPassed ?? true,
          queueVersion: s.queueVersion,
        }
      : null

  const closedReport: CloseShiftDto | null =
    closeResult ??
    closeReportFrom(current) ??
    closeReportFrom(latestClosed as typeof current)

  const byMethod = summaryQuery.data?.byMethod ?? null
  const gross = byMethod
    ? byMethod.CASH + byMethod.OTHER
    : aggregates.collected
  const cashPart = byMethod ? byMethod.CASH : gross
  const otherPart = byMethod ? byMethod.OTHER : 0
  const cashPct = gross > 0 ? (cashPart / gross) * 100 : 0
  const otherPct = gross > 0 ? (otherPart / gross) * 100 : 0

  /* ----------------------------- View ----------------------------- */

  return (
    <>
      <section className="closing-top">
        <div>
          <span className="section-kicker">{arDate(businessDate)}</span>
          <h2>التقرير المالي لنهاية اليوم</h2>
          <p>راجع المصروفات وطابق الخزينة قبل اعتماد الإغلاق.</p>
        </div>
        <div className="closing-status">
          <span className="live-dot" style={{ display: isOpen ? undefined : "none" }} />
          <span>
            <small>حالة اليوم</small>
            <strong>
              {reportShift
                ? reportShift.status === "OPEN"
                  ? "مفتوح للتحصيل"
                  : `مقفلة — ${shiftResultLabel[reportShift.result ?? ""] ?? ""}`
                : "مقفلة"}
            </strong>
          </span>
        </div>
      </section>

      <motion.section
        className="stats-grid four"
        variants={listStagger}
        initial="hidden"
        animate="visible"
      >
        <StatCard
          label="زيارات اليوم"
          value={arNum(summaryQuery.data?.totalServed ?? aggregates.served)}
          hint={isOpen ? "فواتير اليوم الحالية" : "إجمالي مرضى اليوم"}
          icon="users"
          tone="blue"
        />
        <StatCard
          label="الإيراد المسجل"
          value={arNum((summaryQuery.data?.grossCollectedMinor ?? aggregates.collected) / 100)}
          suffix="ج.م."
          hint={
            isOpen
              ? "محصّل حتى الآن (الفواتير)"
              : byMethod
                ? "عبر نقدية وطرق أخرى"
                : "إجمالي التحصيل"
          }
          icon="wallet"
          tone="mint"
        />
        <StatCard
          label="المصروفات النثرية"
          value={arNum((summaryQuery.data?.pettyTotalMinor ?? aggregates.pettyTotal) / 100)}
          suffix="ج.م."
          hint={`${arNum(aggregates.pettyRows.length)} بند مسجل`}
          icon="receipt"
          tone="coral"
        />
        <StatCard
          label={isOpen ? "صافي نقدي مبدئي" : "صافي النقدية"}
          value={arNum(
            ((summaryQuery.data?.cashCollectedMinor ?? cashPart) -
              (summaryQuery.data?.pettyExpenseMinor ?? aggregates.pettyRows
                .filter((p) => p.direction === "EXPENSE")
                .reduce((s, p) => s + p.amountMinor, 0))) / 100,
          )}
          suffix="ج.م."
          hint={isOpen ? "تقديري — يُثبّت عند الإغلاق" : "بعد المصروفات النقدية"}
          icon="banknote"
          tone="teal"
        />
      </motion.section>

      <motion.div
        className="closing-grid"
        variants={listStagger}
        initial="hidden"
        animate="visible"
      >
        <motion.section className="card expenses-card" variants={rise}>
          <div className="card-header">
            <div>
              <h3>المصروفات النثرية</h3>
              <p>المصروفات والإيداعات النقدية المسجلة اليوم.</p>
            </div>
            {isOpen && (
              <AppButton variant="secondary" icon="plus" onClick={() => setShowAddPetty(true)}>
                إضافة مصروف
              </AppButton>
            )}
          </div>
          <div className="expense-list">
            {aggregates.pettyRows.length === 0 && <span>لا بنود مسجلة بعد.</span>}
            {aggregates.pettyRows.map((p) => (
              <span key={p.pettyId}>
                <i className="expense-icon">
                  <Icon name={p.direction === "INJECTION" ? "wallet" : "receipt"} size={17} />
                </i>
                <b>
                  {p.category} — {p.description}
                </b>
                <small>{arTime(p.createdAt)}</small>
                <strong>
                  {p.direction === "INJECTION" ? "+ " : ""}
                  {moneyMinor(p.amountMinor)}
                </strong>
              </span>
            ))}
          </div>
          <div className="expense-total">
            <span>إجمالي البنود</span>
            <strong>{moneyMinor(aggregates.pettyTotal)}</strong>
          </div>
        </motion.section>

        <motion.section className="card reconciliation" variants={rise}>
          <div className="card-header">
            <div>
              <h3>مطابقة الخزينة النقدية</h3>
              <p>
                {isOpen
                  ? "قارن النقد الفعلي بالمبلغ المسجل — يُكشف المتوقع عند الإغلاق (عد أعمى)."
                  : "نتيجة المطابقة النهائية لليوم."}
              </p>
            </div>
            <span
              className={`recon-badge ${
                closedReport
                  ? closedReport.differenceMinor === 0
                    ? "exact"
                    : "short"
                  : "short"
              }`}
            >
              {closedReport
                ? closedReport.differenceMinor === 0
                  ? "متطابق"
                  : closedReport.differenceMinor < 0
                    ? "يوجد عجز"
                    : "يوجد زيادة"
                : "بانتظار الإغلاق"}
            </span>
          </div>
          <div className="recon-values">
            <span>
              <small>النقد المسجل بالنظام</small>
              <strong>
                {closedReport ? moneyMinor(closedReport.expectedCashMinor) : "مخفي حتى الإغلاق"}
              </strong>
            </span>
            <Icon name="arrow" />
            <label className="field money-field">
              <span>النقد الفعلي المعدود</span>
              <input
                type="number"
                value={closedReport ? closedReport.actualCountedMinor / 100 : actual}
                onChange={(e) => setActual(Number(e.target.value))}
                disabled={!isOpen}
              />
              <i>ج.م.</i>
            </label>
          </div>
          <div
            className={`difference-box ${
              closedReport ? (closedReport.differenceMinor === 0 ? "exact" : "") : ""
            }`}
          >
            <span>
              <Icon
                name={
                  closedReport
                    ? closedReport.differenceMinor === 0
                      ? "check"
                      : "alert"
                    : "clock"
                }
              />
              <span>
                <small>نتيجة المطابقة</small>
                <strong>
                  {closedReport
                    ? closedReport.differenceMinor === 0
                      ? "الخزينة متطابقة تمامًا"
                      : `${
                          closedReport.differenceMinor < 0 ? "عجز" : "زيادة"
                        } بقيمة ${moneyMinor(Math.abs(closedReport.differenceMinor))}`
                    : "سيتم احتساب الفرق تلقائيًا عند الإغلاق"}
                </strong>
              </span>
            </span>
            <p>
              {closedReport
                ? closedReport.integrityCheckPassed
                  ? "فحص السلامة المالية ناجح — لا توجد مخالفات."
                  : "راجع تنبيهات السلامة في التقارير الإشرافية."
                : "يعتمد النظام العد الأعمى: يبقى المتوقع مخفيًا حتى إدخال العد الفعلي."}
            </p>
          </div>
          {isOpen && (
            <AppButton
              icon="lock"
              onClick={() => setConfirmClose(true)}
              disabled={actual < 0}
            >
              مراجعة واعتماد الإغلاق
            </AppButton>
          )}
          {!isOpen && (
            <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem", flexWrap: "wrap" }}>
              <AppButton
                variant="secondary"
                icon="arrow"
                onClick={() => reopenMutation.mutate()}
                disabled={reopenMutation.isPending}
              >
                {reopenMutation.isPending ? "جارٍ إعادة الفتح..." : "إعادة فتح اليوم"}
              </AppButton>
              {isDoctor && reportShift && reportShift.result !== null && reportShift.reviewedAt === null && (
                <AppButton icon="check" onClick={() => ackMutation.mutate("تمت المراجعة")}>
                  اعتماد مراجعة اليوم (طبيب)
                </AppButton>
              )}
            </div>
          )}
        </motion.section>
      </motion.div>

      <motion.section className="card report-chart" variants={rise}>
        <div className="card-header">
          <div>
            <h3>توزيع الإيراد حسب طريقة الدفع</h3>
            <p>
              {isOpen
                ? "تقديري من فواتير اليوم الجارية."
                : "إجمالي محصل اليوم (مسجل)."}
            </p>
          </div>
          <select defaultValue="today" disabled title="يعرض تعاملات اليوم">
            <option value="today">اليوم الحالي</option>
          </select>
        </div>
        <div className="chart-body">
          <div
            className="donut"
            style={{
              background: `conic-gradient(var(--primary) 0 ${cashPct}%, var(--teal) ${cashPct}% ${
                cashPct + otherPct
              }%, var(--blue) ${cashPct + otherPct}% 100%)`,
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
              <b>أخرى (Vodafone / InstaPay)</b>
              <small>{moneyMinor(otherPart)}</small>
              <em>{arPercent(otherPart, gross || 1)}</em>
            </span>
            <span>
              <i className="legend-blue" />
              <b>عكس عمليات</b>
              <small>{moneyMinor(summaryQuery.data?.reversalsMinor ?? 0)}</small>
              <em>—</em>
            </span>
          </div>
        </div>
      </motion.section>

      {showAddPetty && current && (
        <AddPettyModal shiftId={current.shiftId} onClose={() => setShowAddPetty(false)} />
      )}

      {confirmClose && current && (
        <Modal
          title="اعتماد إغلاق اليوم"
          subtitle="هذا الإجراء يثبت أرقام الخزينة والتقرير المالي."
          onClose={() => setConfirmClose(false)}
        >
          <div className="confirm-visual">
            <span>
              <Icon name="lock" size={28} />
            </span>
            <h3>هل راجعت كل العمليات؟</h3>
            <p>
              بعد الاعتماد لن يمكن تعديل المصروفات أو التحصيلات إلا بصلاحية الطبيب
              الإدارية.
            </p>
          </div>

          {waitingPatients.length > 0 && (
            <div
              style={{
                margin: "1rem 0",
                padding: "0.9rem",
                borderRadius: "14px",
                background: "oklch(0.8 0.15 90 / 0.14)",
                border: "1px solid oklch(0.8 0.15 90 / 0.5)",
                textAlign: "right",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontWeight: "bold",
                  color: "oklch(0.9 0.11 90)",
                  marginBottom: "0.5rem",
                }}
              >
                <Icon name="alert" size={20} />
                <span>
                  تحذير: يوجد {arNum(waitingPatients.length)} مريض في قائمة الانتظار لم تكتمل زيارتهم بعد!
                </span>
              </div>
              <ul style={{ margin: "0 1.25rem 0.5rem 0", padding: 0, fontSize: "14px", color: "oklch(0.9 0.11 90)" }}>
                {waitingPatients.map((p) => (
                  <li key={p.entryId} style={{ margin: "0.3rem 0" }}>
                    <b style={{ color: "var(--text-strong)" }}>{p.displayName}</b> — {p.status === "IN_CONSULTATION" ? "في غرفة الكشف حاليًا" : "في انتظار الدخول"}
                  </li>
                ))}
              </ul>
              <label className="field" style={{ marginTop: "0.75rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <span style={{ fontSize: "13.5px", fontWeight: "bold", color: "oklch(0.92 0.1 90)" }}>
                  سبب إغلاق اليوم مع وجود مرضى بالانتظار (مطلوب):
                </span>
                <input
                  value={closeReason}
                  onChange={(e) => setCloseReason(e.target.value)}
                  placeholder="اكتب سبب الإغلاق (مثال: اعتذار المرضى / انتهاء موعد العمل بالعيادة)..."
                  style={{
                    width: "100%",
                    padding: "11px 13px",
                    borderRadius: "12px",
                    border: "1px solid oklch(0.8 0.15 90 / 0.6)",
                    fontSize: "14px",
                    background: "oklch(0.25 0.03 280 / 0.55)",
                    color: "var(--text-strong)",
                  }}
                />
              </label>
            </div>
          )}

          <div className="confirm-summary">
            <span>
              النقد الفعلي المعدود <b>{moneyMinor(Math.round(actual * 100))}</b>
            </span>
            <span>
              إجمالي التحصيل الجاري <b>{moneyMinor(aggregates.collected)}</b>
            </span>
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={confirmAck}
              onChange={(e) => setConfirmAck(e.target.checked)}
            />
            <span>أؤكد أنني راجعت النقد الفعلي وسبب أي فارق.</span>
          </label>
          <div className="modal-actions">
            <AppButton variant="outline" onClick={() => setConfirmClose(false)}>
              العودة للمراجعة
            </AppButton>
            <AppButton
              onClick={() => closeMutation.mutate()}
              disabled={
                closeMutation.isPending ||
                !confirmAck ||
                (waitingPatients.length > 0 && closeReason.trim().length < 3)
              }
            >
              {closeMutation.isPending ? "جارٍ الإغلاق..." : "اعتماد وإغلاق اليوم"}
            </AppButton>
          </div>
        </Modal>
      )}
    </>
  )
}
