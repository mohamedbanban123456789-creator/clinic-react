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
import { shiftsApi } from "@/api/shifts"
import { supervisionApi } from "@/api/admin"
import { useShiftInvoices } from "@/hooks/useShiftInvoices"
import { apiErrorMessage, ApiError } from "@/api/client"
import { AppButton, Icon, Modal, StatCard, useToast } from "@/components/ui"
import { useAuth } from "@/auth/AuthContext"
import { arNum, arDate, arTime, moneyMinor, arPercent } from "@/lib/format"
import { pettyDirectionLabel, shiftResultLabel } from "@/lib/constants"
import type { CloseShiftDto } from "@/api/types"

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
      subtitle="يُسجل البند في سجل الوردية الحالية."
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
  const [forceClose, setForceClose] = useState(false)
  const [forceReason, setForceReason] = useState("")
  const [closeResult, setCloseResult] = useState<CloseShiftDto | null>(null)

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

  const current = shiftQuery.data
  const isOpen = current?.status === "OPEN"

  // Doctor post-close view: latest CLOSED shift (from the supervision feed)
  // when no live shift exists — enables review/ack on a fresh page load.
  const latestClosed = isDoctor
    ? (closedShiftsQuery.data?.data ?? []).find(
        (s) => s.status === "CLOSED" && s.reviewedAt === null,
      ) ?? (closedShiftsQuery.data?.data ?? []).find((s) => s.status === "CLOSED")
    : undefined

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

  const openMutation = useMutation({
    mutationFn: () => shiftsApi.open(Math.round(actual * 100)),
    onSuccess: (shift) => {
      notify(`فُتحت وردية ${arDate(shift.businessDate)} — الطابور جاهز`)
      setActual(0)
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
      void queryClient.invalidateQueries({ queryKey: ["queue"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const closeMutation = useMutation({
    mutationFn: () =>
      shiftsApi.close(reportShiftId!, Math.round(actual * 100), {
        force: forceClose,
        ...(forceClose && forceReason.trim() ? { forceReason: forceReason.trim() } : {}),
      }),
    onSuccess: (result) => {
      setCloseResult(result)
      setConfirmClose(false)
      notify("تم إغلاق الخزينة وحفظ تقرير اليوم")
      void queryClient.invalidateQueries({ queryKey: ["shifts"] })
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
      void queryClient.invalidateQueries({ queryKey: ["receipts"] })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "SHIFT_LOCKED") {
        notify("توجد مرضى لم تكتمل زيارتهم — فعّل الإغلاق القسري مع السبب", "error")
      } else {
        notify(apiErrorMessage(err), "error")
      }
    },
  })

  const ackMutation = useMutation({
    mutationFn: (note: string) => supervisionApi.ackShift(reportShiftId!, note || undefined),
    onSuccess: () => {
      notify("تم اعتماد مراجعة الوردية")
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

  /* --------------------------- No shift --------------------------- */

  if (!current && !closeResult && !latestClosed) {
    return (
      <section className="card form-card">
        <div className="step-header">
          <span className="step-no">١</span>
          <div>
            <h2>فتح وردية جديدة</h2>
            <p>أدخل العد النقدي الفعلي في الدرج لبدء يوم العمل (عد أعمى لضمان الدقة).</p>
          </div>
        </div>
        <label className="field money-field">
          <span>النقد الفعلي في الدرج الآن</span>
          <input
            type="number"
            value={actual || ""}
            onChange={(e) => setActual(Number(e.target.value))}
          />
          <i>ج.م.</i>
        </label>
        <AppButton
          icon="lock"
          onClick={() => openMutation.mutate()}
          disabled={openMutation.isPending || actual < 0}
        >
          {openMutation.isPending ? "جارٍ الفتح..." : "فتح الوردية"}
        </AppButton>
      </section>
    )
  }

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

      <section className="stats-grid four">
        <StatCard
          label="زيارات الوردية"
          value={arNum(summaryQuery.data?.totalServed ?? aggregates.served)}
          hint={isOpen ? "فواتير الوردية الحالية" : "إجمالي مرضى الوردية"}
          icon="users"
          tone="violet"
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
          tone="amber"
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
          icon="chart"
          tone="blue"
        />
      </section>

      <div className="closing-grid">
        <section className="card expenses-card">
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
        </section>

        <section className="card reconciliation">
          <div className="card-header">
            <div>
              <h3>مطابقة الخزينة النقدية</h3>
              <p>
                {isOpen
                  ? "قارن النقد الفعلي بالمبلغ المسجل — يُكشف المتوقع عند الإغلاق (عد أعمى)."
                  : "نتيجة المطابقة النهائية للوردية."}
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
          {isOpen && isDoctor && (
            <>
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={forceClose}
                  onChange={(e) => setForceClose(e.target.checked)}
                />
                <span>إغلاق قسري (توجد زيارات غير مكتملة)</span>
              </label>
              {forceClose && (
                <label className="field">
                  <span>سبب الإغلاق القسري (١٠ أحرف على الأقل)</span>
                  <input
                    value={forceReason}
                    onChange={(e) => setForceReason(e.target.value)}
                    placeholder="مثال: انتهاء دوام العيادة مع مرضى متأخرين"
                  />
                </label>
              )}
            </>
          )}
          {isOpen && (
            <AppButton
              icon="lock"
              onClick={() => setConfirmClose(true)}
              disabled={actual < 0 || (forceClose && forceReason.trim().length < 10)}
            >
              مراجعة واعتماد الإغلاق
            </AppButton>
          )}
          {!isOpen && isDoctor && reportShift && reportShift.result !== null && reportShift.reviewedAt === null && (
            <AppButton icon="check" onClick={() => ackMutation.mutate("تمت المراجعة")}>
              اعتماد مراجعة الوردية (طبيب)
            </AppButton>
          )}
        </section>
      </div>

      <section className="card report-chart">
        <div className="card-header">
          <div>
            <h3>توزيع الإيراد حسب طريقة الدفع</h3>
            <p>
              {isOpen
                ? "تقديري من فواتير الوردية الجارية."
                : "إجمالي محصل الوردية (مسجل)."}
            </p>
          </div>
          <select defaultValue="today" disabled title="يعرض الوردية الحالية/الأخيرة">
            <option value="today">هذه الوردية</option>
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
      </section>

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
              disabled={closeMutation.isPending || !confirmAck}
            >
              {closeMutation.isPending ? "جارٍ الإغلاق..." : "اعتماد وإغلاق اليوم"}
            </AppButton>
          </div>
        </Modal>
      )}
    </>
  )
}
