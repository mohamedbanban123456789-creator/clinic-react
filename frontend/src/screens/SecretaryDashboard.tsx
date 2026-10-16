/**
 * Secretary dashboard — design preserved from the Figma export; live data:
 * queue from REST + WebSocket snapshot, stats computed from the queue, and
 * revenue aggregated from today's invoices (billing list is visible while
 * the shift is open — receipts are only exposed after close, and the shift
 * summary follows the blind-cash rule, so live collection uses invoices).
 */

import { useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useQueue, useQueueInvalidation } from "@/hooks/useQueue"
import { useShiftInvoices } from "@/hooks/useShiftInvoices"
import { queueApi } from "@/api/queue"
import { shiftsApi } from "@/api/shifts"
import { settingsApi } from "@/api/admin"
import { apiErrorMessage } from "@/api/client"
import { AppButton, Icon, StatCard, useToast } from "@/components/ui"
import { useAuth } from "@/auth/AuthContext"
import { useCallRequest } from "@/realtime/socket"
import {
  arGreeting,
  arNum,
  minutesSince,
  moneyMinor,
} from "@/lib/format"
import {
  queueStatusLabel,
  queueStatusBadge,
  emergencyReasonLabel,
  tSec,
} from "@/lib/constants"
import type { QueueEntryDto } from "@/api/types"

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge badge-${queueStatusBadge[status as keyof typeof queueStatusBadge] ?? "waiting"}`}>
      <span className="badge-dot" />
      {queueStatusLabel[status as keyof typeof queueStatusLabel] ?? status}
    </span>
  )
}

export default function SecretaryDashboard() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { user } = useAuth()
  const { queue, entries, isLoading, isError, error, queueVersion } = useQueue()
  const invalidate = useQueueInvalidation()
  const isDoctor = user?.role === "DOCTOR"

  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => shiftsApi.current(),
    refetchInterval: 120_000,
  })

  const shiftId = shiftQuery.data?.status === "OPEN" ? shiftQuery.data.shiftId : undefined

  // Role-aware invoice aggregation (doctor: shift scope; secretary: patient scope).
  const invoicesQuery = useShiftInvoices(shiftId)

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    staleTime: 300_000,
  })

  const stats = useMemo(() => {
    const waiting = entries.filter((e) => e.status === "WAITING")
    const current = entries.filter((e) => e.status === "IN_CONSULTATION")
    const done = entries.filter((e) => e.status === "COMPLETED")
    const invoices = invoicesQuery.invoices ?? []
    const collected = invoices.reduce((sum, inv) => sum + inv.collectedMinor, 0)
    const unpaid = invoices.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL").length
    return { waiting, current, done, collected, unpaid, total: entries.length }
  }, [entries, invoicesQuery.invoices])

  const nextWaiting = stats.waiting[0]

  /**
   * Display order per the design: current session first, waiting (emergency
   * priority, then position), skipped, terminal statuses at the bottom.
   */
  const displayEntries = useMemo(() => {
    const rank = (e: QueueEntryDto): number => {
      switch (e.status) {
        case "IN_CONSULTATION":
          return 0
        case "WAITING":
          return 1
        case "SKIPPED":
          return 2
        default:
          return 3
      }
    }
    return [...entries].sort((a, b) => {
      const ra = rank(a)
      const rb = rank(b)
      if (ra !== rb) return ra - rb
      if (a.isEmergency !== b.isEmergency) return a.isEmergency ? -1 : 1
      if (a.position !== b.position) return a.position - b.position
      return new Date(a.checkedInAt).getTime() - new Date(b.checkedInAt).getTime()
    })
  }, [entries])

  /* ------------------------- Queue mutations ------------------------- */

  const [draggedEntryId, setDraggedEntryId] = useState<string | null>(null)
  const [dragOverEntryId, setDragOverEntryId] = useState<string | null>(null)

  const reorderableWaiting = useMemo(() => {
    return displayEntries.filter((e) => e.status === "WAITING" && !e.isEmergency)
  }, [displayEntries])

  const reorderMutation = useMutation({
    mutationFn: (newOrder: string[]) => {
      const currentIds = reorderableWaiting.map((e) => e.entryId)
      // Check if order actually changed or if queue has <= 1 patient
      if (
        newOrder.length !== currentIds.length ||
        newOrder.every((id, idx) => id === currentIds[idx])
      ) {
        return Promise.resolve(null)
      }
      return queueApi.reorder(queueVersion, newOrder)
    },
    onSuccess: (res) => {
      if (res !== null) {
        notify("تم تحديث ترتيب الطابور")
        invalidate()
      }
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const moveEntry = (entryId: string, direction: -1 | 1) => {
    const ids = reorderableWaiting.map((e) => e.entryId)
    const idx = ids.indexOf(entryId)
    if (idx < 0) return
    const target = idx + direction
    if (target < 0 || target >= ids.length) return // Edge move is silent no-op
    const next = [...ids]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    reorderMutation.mutate(next)
  }

  const handleDrop = (targetEntryId: string) => {
    if (!draggedEntryId || draggedEntryId === targetEntryId) {
      setDraggedEntryId(null)
      setDragOverEntryId(null)
      return
    }
    const ids = reorderableWaiting.map((e) => e.entryId)
    const fromIdx = ids.indexOf(draggedEntryId)
    const toIdx = ids.indexOf(targetEntryId)
    setDraggedEntryId(null)
    setDragOverEntryId(null)
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return // drop ignored
    const next = [...ids]
    const [moved] = next.splice(fromIdx, 1)
    next.splice(toIdx, 0, moved)
    reorderMutation.mutate(next)
  }

  const noShowMutation = useMutation({
    mutationFn: (entry: QueueEntryDto) =>
      queueApi.noShow(entry.entryId, "LEFT_WITHOUT_NOTICE"),
    onSuccess: (entry) => {
      notify(`تم تسجيل عدم حضور ${entry.displayName}`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const requeueMutation = useMutation({
    mutationFn: (entry: QueueEntryDto) => queueApi.requeue(entry.entryId),
    onSuccess: (entry) => {
      notify(`أُعيد ${entry.displayName} إلى الطابور`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const emergencyMutation = useMutation({
    mutationFn: (entry: QueueEntryDto) =>
      queueApi.emergency(entry.entryId, !entry.isEmergency, !entry.isEmergency ? "OTHER_URGENT" : undefined, queueVersion),
    onSuccess: (entry) => {
      notify(
        entry.isEmergency
          ? `تم رفع أولوية ${entry.displayName} (طارئ)`
          : `أُلغيت حالة الطوارئ لـ${entry.displayName}`,
      )
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const debtAckMutation = useMutation({
    mutationFn: (entry: QueueEntryDto) => queueApi.debtAck(entry.entryId),
    onSuccess: (entry) => {
      notify(`تم إقرار ${entry.displayName} بالرصيد المستحق`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const callNextMutation = useMutation({
    mutationFn: () => queueApi.callNext(),
    onSuccess: (entry) => {
      notify(`تم استدعاء ${entry.displayName}`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const approveCallMutation = useMutation({
    mutationFn: (id: string) => queueApi.approveCallRequest(id),
    onSuccess: (req) => {
      notify(`المريض ${req.patientName} جاهز ودخل العيادة الآن`, "success")
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const cancelCallMutation = useMutation({
    mutationFn: (id: string) => queueApi.cancelCallRequest(id),
    onSuccess: (req) => {
      notify(`تم إلغاء استدعاء ${req.patientName}`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  useCallRequest((event) => {
    if (event.type === "created") {
      notify(`طلب استدعاء جديد من الطبيب: المريض ${event.payload.patientName} مطلوب بالداخل`)
      invalidate()
    } else if (event.type === "cancelled") {
      notify(`تم إلغاء طلب استدعاء ${event.payload.patientName}`)
      invalidate()
    }
  })

  const completeMutation = useMutation({
    mutationFn: (entry: QueueEntryDto) => queueApi.complete(entry.entryId),
    onSuccess: (entry) => {
      notify(`اكتملت زيارة ${entry.displayName} — أُنشئت فاتورة غير مدفوعة`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  /* ----------------------------- Render ----------------------------- */

  const rawName = user?.name && !/^\?+$/.test(user.name.trim())
    ? user.name.trim()
    : (isDoctor ? "د. أحمد سامي" : (user?.gender === "MALE" ? "أحمد محمود" : "سارة محمود"))
  const firstName = rawName.replace(/^د\.\s*/, "").split(" ")[0] || rawName
  const avgMin = settingsQuery.data?.avgConsultDurationMin ?? 20

  return (
    <>
      <section className="welcome-strip">
        <div>
          <span className="eyebrow">
            {arGreeting()}، {firstName}
          </span>
          <h2>
            العيادة تعمل بهدوء اليوم
          </h2>
          <p>
            {stats.waiting.length > 0
              ? `لديك ${arNum(stats.waiting.length)} مرضى في الانتظار، ومتوسط وقت الكشف ${arNum(avgMin)} دقيقة.`
              : tSec(
                  "لا مرضى في الانتظار حاليًا. يمكنك تسجيل الحضور أو إضافة مريض جديد.",
                  "لا مرضى في الانتظار حاليًا. يمكنكِ تسجيل الحضور أو إضافة مريض جديد.",
                  user?.gender,
                )}
          </p>
        </div>
        <div className="quick-actions">
          <AppButton icon="userPlus" onClick={() => navigate("/secretary/checkin")}>
            تسجيل حضور
          </AppButton>
          <AppButton
            icon="plus"
            variant="secondary"
            onClick={() => navigate("/secretary/checkin?new=1")}
          >
            مريض جديد
          </AppButton>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          label="زيارات اليوم"
          value={arNum(stats.total)}
          hint="إجمالي سجلات الطابور اليوم"
          icon="users"
          tone="violet"
        />
        <StatCard
          label="في الانتظار"
          value={arNum(stats.waiting.length)}
          hint={nextWaiting ? `التالي: ${nextWaiting.displayName}` : "لا انتظار حاليًا"}
          icon="clock"
          tone="amber"
        />
        <StatCard
          label="مع الطبيب"
          value={arNum(stats.current.length)}
          hint={
            stats.current[0]
              ? `بدأت منذ ${arNum(minutesSince(stats.current[0].calledAt))} دقيقة`
              : "لا جلسة جارية"
          }
          icon="heart"
          tone="blue"
        />
        <StatCard
          label="زيارات مكتملة"
          value={arNum(stats.done.length)}
          hint={`${arNum(stats.unpaid)} فاتورة بانتظار التحصيل`}
          icon="check"
          tone="mint"
        />
        <StatCard
          label="إيراد اليوم"
          value={arNum(stats.collected / 100)}
          suffix="ج.م."
          hint="محصّل من فواتير اليوم"
          icon="wallet"
          tone="coral"
        />
      </section>

      <div className="dashboard-grid">
        <section className="card queue-card">
          <div className="card-header">
            <div>
              <span className="section-kicker">مباشر الآن</span>
              <h3>قائمة انتظار اليوم</h3>
              <p>يُرتب الطابور تلقائيًا حسب الوصول مع أولوية الحالات الطارئة.</p>
            </div>
            {isDoctor && (
              <AppButton icon="phone" onClick={() => callNextMutation.mutate()} disabled={callNextMutation.isPending || stats.waiting.length === 0}>
                استدعاء التالي
              </AppButton>
            )}
          </div>

          {queue?.activeCallRequest && (
            <div
              className="call-request-banner"
              style={{
                background: "linear-gradient(135deg, rgba(101, 84, 217, 0.12), rgba(101, 84, 217, 0.05))",
                border: "2px solid var(--color-primary, #6554D9)",
                borderRadius: "14px",
                padding: "16px 20px",
                marginBottom: "20px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div
                  style={{
                    width: "42px",
                    height: "42px",
                    borderRadius: "50%",
                    background: "var(--color-primary, #6554D9)",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Icon name="phone" size={20} />
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <strong style={{ fontSize: "16px", color: "var(--color-text-primary, #29264F)" }}>
                      الدكتور مستني مريض
                    </strong>
                    <span
                      style={{
                        fontSize: "12px",
                        background: "var(--color-primary-soft, #EEEBFF)",
                        color: "var(--color-primary, #6554D9)",
                        padding: "2px 8px",
                        borderRadius: "6px",
                        fontWeight: 600,
                      }}
                    >
                      طلب استدعاء نشط
                    </span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "14px", color: "var(--color-text-secondary, #55566F)" }}>
                    المريض المطلوب: <strong style={{ color: "var(--color-primary, #6554D9)" }}>{queue.activeCallRequest.patientName}</strong> — يُرجى مناداته وتأكيد دخوله للكشف.
                  </p>
                </div>
              </div>
              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <AppButton
                  variant="outline"
                  onClick={() => cancelCallMutation.mutate(queue.activeCallRequest!.id)}
                  disabled={cancelCallMutation.isPending || approveCallMutation.isPending}
                >
                  إلغاء الطلب
                </AppButton>
                <AppButton
                  icon="check"
                  onClick={() => approveCallMutation.mutate(queue.activeCallRequest!.id)}
                  disabled={approveCallMutation.isPending}
                >
                  {approveCallMutation.isPending ? "جارٍ التحديث..." : "المريض جاهز"}
                </AppButton>
              </div>
            </div>
          )}

          <div className="queue-table">
            <div className="queue-head">
              <span>الترتيب</span>
              <span>المريض</span>
              <span>الوصول</span>
              <span>الحالة</span>
              <span>الانتظار المتوقع</span>
              <span>إجراء</span>
            </div>
            {isLoading && (
              <div className="queue-row"><span>جارٍ تحميل الطابور…</span></div>
            )}
            {isError && (
              <div className="queue-row">
                <span>تعذر تحميل الطابور: {apiErrorMessage(error)}</span>
              </div>
            )}
            {!isLoading && !isError && entries.length === 0 && (
              <div className="queue-row">
                <span>لا مرضى في الطابور بعد — سجّل أول حضور.</span>
              </div>
            )}
            {displayEntries.map((patient, index) => {
              const actionable =
                patient.status === "WAITING" ||
                patient.status === "SKIPPED" ||
                patient.status === "IN_CONSULTATION"
              const primaryAction = () => {
                if (patient.status === "SKIPPED") {
                  requeueMutation.mutate(patient)
                } else if (patient.status === "WAITING") {
                  if (isDoctor) {
                    noShowMutation.mutate(patient)
                  } else {
                    noShowMutation.mutate(patient)
                  }
                } else if (patient.status === "IN_CONSULTATION") {
                  if (isDoctor) completeMutation.mutate(patient)
                  else navigate("/chat")
                }
              }
              const primaryLabel =
                patient.status === "SKIPPED"
                  ? "إعادة"
                  : patient.status === "WAITING"
                    ? "عدم حضور"
                    : patient.status === "IN_CONSULTATION"
                      ? isDoctor ? "إنهاء" : "إبلاغ الطبيب"
                      : "—"
              const isReorderable = patient.status === "WAITING" && !patient.isEmergency
              const waitingIdx = reorderableWaiting.findIndex((e) => e.entryId === patient.entryId)
              const isFirst = waitingIdx === 0
              const isLast = waitingIdx === reorderableWaiting.length - 1
              const canReorder = isReorderable && reorderableWaiting.length > 1

              return (
                <div
                  className={`queue-row ${patient.isEmergency ? "emergency" : ""} ${
                    patient.entryId === nextWaiting?.entryId ? "next-row" : ""
                  } ${isReorderable && canReorder ? "draggable" : ""} ${
                    draggedEntryId === patient.entryId ? "dragging" : ""
                  } ${dragOverEntryId === patient.entryId ? "drag-over" : ""}`}
                  key={patient.entryId}
                  draggable={canReorder && !reorderMutation.isPending}
                  onDragStart={(e) => {
                    if (!canReorder) return
                    setDraggedEntryId(patient.entryId)
                    e.dataTransfer.effectAllowed = "move"
                  }}
                  onDragOver={(e) => {
                    if (canReorder && draggedEntryId && draggedEntryId !== patient.entryId) {
                      e.preventDefault()
                      e.dataTransfer.dropEffect = "move"
                    }
                  }}
                  onDragEnter={() => {
                    if (canReorder && draggedEntryId && draggedEntryId !== patient.entryId) {
                      setDragOverEntryId(patient.entryId)
                    }
                  }}
                  onDragLeave={() => {
                    if (dragOverEntryId === patient.entryId) {
                      setDragOverEntryId(null)
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleDrop(patient.entryId)
                  }}
                  onDragEnd={() => {
                    setDraggedEntryId(null)
                    setDragOverEntryId(null)
                  }}
                >
                  <div className="position">
                    {isReorderable && canReorder && (
                      <span className="drag-handle" title="اسحب لتغيير الترتيب" aria-label="اسحب لتغيير الترتيب">
                        <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
                          <circle cx="3" cy="3" r="1.4" />
                          <circle cx="7" cy="3" r="1.4" />
                          <circle cx="3" cy="7" r="1.4" />
                          <circle cx="7" cy="7" r="1.4" />
                          <circle cx="3" cy="11" r="1.4" />
                          <circle cx="7" cy="11" r="1.4" />
                        </svg>
                      </span>
                    )}
                    <span>
                      {patient.status === "COMPLETED" ||
                      patient.status === "NO_SHOW" ||
                      patient.status === "ABANDONED"
                        ? "—"
                        : arNum(
                            patient.status === "WAITING"
                              ? stats.waiting.findIndex((w) => w.entryId === patient.entryId) + 1
                              : patient.position,
                          )}
                    </span>
                    {isReorderable && (
                      <div className="move-controls" role="group" aria-label="تغيير الترتيب">
                        <button
                          type="button"
                          title="تحريك لأعلى"
                          aria-label="تحريك لأعلى"
                          onClick={() => moveEntry(patient.entryId, -1)}
                          disabled={reorderMutation.isPending || isFirst || !canReorder}
                        >
                          ⌃
                        </button>
                        <button
                          type="button"
                          title="تحريك لأسفل"
                          aria-label="تحريك لأسفل"
                          onClick={() => moveEntry(patient.entryId, 1)}
                          disabled={reorderMutation.isPending || isLast || !canReorder}
                        >
                          ⌄
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="patient-cell">
                    <span className={`patient-avatar a${index % 4}`}>
                      {patient.displayName.charAt(0)}
                    </span>
                    <span>
                      <strong>{patient.displayName}</strong>
                      <small>{patient.patientId.slice(-6)}</small>
                    </span>
                    {patient.isEmergency && (
                      <span className="emergency-tag" title={emergencyReasonLabel[patient.emergencyReasonCode ?? ""] ?? ""}>
                        <Icon name="alert" size={13} /> طارئ
                      </span>
                    )}
                  </div>
                  <span>{new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(patient.checkedInAt))}</span>
                  <StatusBadge status={patient.status} />
                  <span className="wait-time">
                    {patient.status === "WAITING" ? (
                      <>
                        <Icon name="clock" size={15} /> نحو {arNum(patient.estimatedWaitMin)}{" "}
                        دقيقة
                      </>
                    ) : (
                      "—"
                    )}
                  </span>
                  {patient.debtAlert && patient.debtAlert.outstandingMinor > 0 && !patient.debtAckAt ? (
                    <button
                      className="row-action"
                      title={`رصيد سابق ${moneyMinor(patient.debtAlert.outstandingMinor)} — اضغط للإقرار`}
                      onClick={() => debtAckMutation.mutate(patient)}
                      disabled={debtAckMutation.isPending}
                    >
                      إقرار بالرصيد
                      <Icon name="arrow" size={15} />
                    </button>
                  ) : queue?.activeCallRequest?.queueEntryId === patient.entryId ? (
                    <AppButton
                      icon="check"
                      onClick={() => approveCallMutation.mutate(queue.activeCallRequest!.id)}
                      disabled={approveCallMutation.isPending}
                    >
                      المريض جاهز
                    </AppButton>
                  ) : actionable ? (
                    <button
                      className="row-action"
                      onClick={primaryAction}
                      disabled={noShowMutation.isPending || requeueMutation.isPending || completeMutation.isPending}
                    >
                      {primaryLabel}
                      <Icon name="arrow" size={15} />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              )
            })}
          </div>
        </section>
        <aside className="side-stack">
          <section className="card next-patient-card">
            <div className="mini-title">
              <span className="live-dot" /> التالي للدخول
            </div>
            {nextWaiting ? (
              <>
                <div className="next-person">
                  <div className="patient-avatar large">
                    {nextWaiting.displayName.charAt(0)}
                  </div>
                  <div>
                    <h3>{nextWaiting.displayName}</h3>
                    <p>
                      {nextWaiting.patientId.slice(-6)} ·{" "}
                      {nextWaiting.isEmergency ? "حالة طارئة" : "في الطابور"}
                    </p>
                  </div>
                </div>
                <div className="wait-highlight">
                  <Icon name="clock" />
                  <span>
                    <small>الانتظار المتوقع</small>
                    <strong>{arNum(nextWaiting.estimatedWaitMin)} دقيقة</strong>
                  </span>
                </div>
              </>
            ) : (
              <div className="next-person">
                <div className="patient-avatar large">؟</div>
                <div>
                  <h3>لا مرضى في الانتظار</h3>
                  <p>سيظهر المريض التالي هنا تلقائيًا.</p>
                </div>
              </div>
            )}
            <AppButton variant="outline" icon="message" onClick={() => navigate("/chat")}>
              إبلاغ الطبيب
            </AppButton>
          </section>
          <section className="card balance-card">
            <div className="mini-title">
              <Icon name="wallet" size={18} /> ملخص التحصيل
            </div>
            <div className="balance-main">
              <span>إجمالي اليوم</span>
              <strong>
                {arNum(stats.collected / 100)} <small>ج.م.</small>
              </strong>
            </div>
            <div className="payment-breakdown">
              <span>
                <i className="cash" />
                فواتير مدفوعة <b>{arNum((invoicesQuery.invoices ?? []).filter((i) => i.status === "PAID").length)}</b>
              </span>
              <span>
                <i className="vodafone" />
                بانتظار التحصيل <b>{arNum(stats.unpaid)}</b>
              </span>
              <span>
                <i className="insta" />
                مكتملة اليوم <b>{arNum(stats.done.length)}</b>
              </span>
            </div>
            <button className="text-link" onClick={() => navigate("/secretary/payments")}>
              فتح المدفوعات <Icon name="arrow" size={15} />
            </button>
          </section>
        </aside>
      </div>
    </>
  )
}
