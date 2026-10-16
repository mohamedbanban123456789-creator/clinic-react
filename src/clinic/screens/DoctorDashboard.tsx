/**
 * Doctor dashboard — design preserved; live session context from the queue
 * (IN_CONSULTATION entry), call-next / skip wired to real endpoints, live
 * session timer, review card fed by supervision/unsigned-notes, and the
 * doctor's floating chat.
 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/clinic/auth/AuthContext"
import { useQueue, useQueueInvalidation } from "@/clinic/hooks/useQueue"
import { queueApi } from "@/clinic/api/queue"
import { supervisionApi, settingsApi } from "@/clinic/api/admin"
import { billingApi } from "@/clinic/api/billing"
import { patientsApi } from "@/clinic/api/patients"
import { apiErrorMessage, ApiError } from "@/clinic/api/client"
import { AppButton, Icon, Modal, StatCard, useToast } from "@/clinic/components/ui"
import { useChat } from "@/clinic/context/ChatContext"
import { useCallRequest } from "@/clinic/realtime/socket"
import { arNum, arTimer, arDate, ageFromDob, arAgo, moneyMinor } from "@/clinic/lib/format"
import { emergencyReasonLabel } from "@/clinic/lib/constants"
import type { UnsignedNotesDto, QueueEntryDto } from "@/clinic/api/types"

function ReviewModal({
  data,
  onClose,
  onRefresh,
}: {
  data: UnsignedNotesDto | undefined
  onClose: () => void
  onRefresh: () => void
}) {
  const { notify } = useToast()
  const navigate = useNavigate()
  const [deferringEntryId, setDeferringEntryId] = useState<string | null>(null)
  const [deferReason, setDeferReason] = useState("")

  const deferMutation = useMutation({
    mutationFn: ({ entryId, reason }: { entryId: string; reason: string }) =>
      queueApi.deferDocumentation(entryId, reason),
    onSuccess: () => {
      notify("تم تسجيل تأجيل التوثيق بنجاح")
      setDeferringEntryId(null)
      setDeferReason("")
      onRefresh()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const unsignedList = (data?.completedWithoutSigned ?? []).filter((c) => !c.isDeferred)
  const deferredList = (data?.completedWithoutSigned ?? []).filter((c) => c.isDeferred)

  return (
    <Modal
      title="مراجعة التوثيق والكشوفات"
      subtitle="الكشوفات المكتملة غير الموثقة والتأجيلات المسجلة اليوم."
      onClose={onClose}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem", textAlign: "right" }}>
        <div>
          <h4 style={{ margin: "0 0 0.5rem 0", color: "var(--text-strong)", fontSize: "16px" }}>
            كشوفات بانتظار التوثيق والتوقيع ({arNum(unsignedList.length)})
          </h4>
          {unsignedList.length === 0 ? (
            <p style={{ color: "oklch(1 0 0 / 0.72)", margin: 0, fontSize: "14px" }}>
              جميع كشوفات اليوم موثقة وموقعة بنجاح.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {unsignedList.map((item) => (
                <div
                  key={item.queueEntryId}
                  style={{
                    padding: "0.85rem",
                    borderRadius: "14px",
                    background: "oklch(0.74 0.16 15 / 0.12)",
                    border: "1px solid oklch(0.74 0.16 15 / 0.35)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                    <div>
                      <strong style={{ fontSize: "15px", color: "var(--text-strong)" }}>{item.displayName}</strong>
                      <span style={{ fontSize: "13px", color: "oklch(1 0 0 / 0.72)", marginRight: "0.5rem" }}>
                        اكتمل الكشف {item.completedAt ? arDate(item.completedAt) : ""}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      <AppButton
                        variant="primary"
                        onClick={() => {
                          onClose()
                          navigate(`/doctor/soap?patientId=${item.patientId}&queueEntryId=${item.queueEntryId}`)
                        }}
                      >
                        توثيق SOAP
                      </AppButton>
                      <AppButton
                        variant="outline"
                        onClick={() => {
                          setDeferringEntryId(item.queueEntryId)
                          setDeferReason("")
                        }}
                      >
                        تأجيل التوثيق
                      </AppButton>
                    </div>
                  </div>

                  {deferringEntryId === item.queueEntryId && (
                    <div style={{ marginTop: "0.75rem", padding: "0.65rem", background: "oklch(1 0 0 / 0.08)", borderRadius: "12px", border: "1px solid oklch(1 0 0 / 0.2)" }}>
                      <label style={{ display: "block", fontSize: "13.5px", fontWeight: "bold", marginBottom: "0.35rem", color: "oklch(1 0 0 / 0.88)" }}>
                        سبب تأجيل التوثيق (مطلوب):
                      </label>
                      <input
                        value={deferReason}
                        onChange={(e) => setDeferReason(e.target.value)}
                        placeholder="اكتب سبب التأجيل (مثال: بانتظار نتائج التحاليل، انشغال طارئ)..."
                        style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid oklch(1 0 0 / 0.25)", fontSize: "14px", background: "oklch(0.25 0.03 280 / 0.55)", color: "var(--text-strong)" }}
                      />
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", justifyContent: "flex-end" }}>
                        <AppButton variant="outline" onClick={() => setDeferringEntryId(null)}>
                          إلغاء
                        </AppButton>
                        <AppButton
                          variant="secondary"
                          onClick={() =>
                            deferMutation.mutate({ entryId: item.queueEntryId, reason: deferReason.trim() })
                          }
                          disabled={deferMutation.isPending || deferReason.trim().length < 3}
                        >
                          {deferMutation.isPending ? "جارٍ الحفظ..." : "تأكيد التأجيل"}
                        </AppButton>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {deferredList.length > 0 && (
          <div>
            <h4 style={{ margin: "0 0 0.5rem 0", color: "oklch(0.9 0.11 90)", fontSize: "16px" }}>
              حالات التوثيق المؤجلة ({arNum(deferredList.length)})
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {deferredList.map((item) => (
                <div
                  key={item.queueEntryId}
                  style={{
                    padding: "0.7rem 0.85rem",
                    borderRadius: "12px",
                    background: "oklch(0.8 0.15 90 / 0.12)",
                    border: "1px solid oklch(0.8 0.15 90 / 0.35)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px",
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <strong style={{ color: "var(--text-strong)" }}>{item.displayName}</strong>
                    <div style={{ fontSize: "13px", color: "oklch(0.9 0.11 90)" }}>
                      سبب التأجيل: {item.deferredReason || "غير محدد"}
                    </div>
                  </div>
                  <AppButton
                    variant="outline"
                    onClick={() => {
                      onClose()
                      navigate(`/doctor/soap?patientId=${item.patientId}&queueEntryId=${item.queueEntryId}`)
                    }}
                  >
                    توثيق الآن
                  </AppButton>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <AppButton variant="outline" onClick={onClose}>
            إغلاق
          </AppButton>
        </div>
      </div>
    </Modal>
  )
}

export default function DoctorDashboard() {
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"
  const navigate = useNavigate()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const { queue, entries, isLoading, queueVersion } = useQueue()
  const invalidate = useQueueInvalidation()
  const { setOnComplimentary } = useChat()
  const [showComplimentary, setShowComplimentary] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)

  useEffect(() => {
    setOnComplimentary(() => () => setShowComplimentary(true))
    return () => setOnComplimentary(undefined)
  }, [setOnComplimentary])

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    staleTime: 300_000,
  })

  const unsignedQuery = useQuery({
    queryKey: ["supervision", "unsigned-notes"],
    queryFn: () => supervisionApi.unsignedNotes(),
    enabled: isDoctor,
    refetchInterval: 120_000,
  })

  const current = entries.find((e) => e.status === "IN_CONSULTATION")
  const waiting = entries.filter((e) => e.status === "WAITING")
  const completed = entries.filter((e) => e.status === "COMPLETED")

  const avgSession = useMemo(() => {
    const durations = completed
      .filter((e) => e.completedAt && e.calledAt)
      .map((e) => new Date(e.completedAt as string).getTime() - new Date(e.calledAt as string).getTime())
    if (durations.length === 0) return settingsQuery.data?.avgConsultDurationMin ?? 20
    return Math.round(durations.reduce((s, d) => s + d, 0) / durations.length / 60000)
  }, [completed, settingsQuery.data])

  const [pendingCallPatient, setPendingCallPatient] = useState<QueueEntryDto | null>(null)

  const pendingPatientDetailQuery = useQuery({
    queryKey: ["patients", pendingCallPatient?.patientId],
    queryFn: () => patientsApi.get(pendingCallPatient!.patientId),
    enabled: !!pendingCallPatient?.patientId,
  })

  const handleOpenCallReview = () => {
    if (waiting.length === 0 || queue?.activeCallRequest) return
    setPendingCallPatient(waiting[0])
  }

  const createCallRequestMutation = useMutation({
    mutationFn: (opts?: { entryId?: string }) => queueApi.createCallRequest(opts?.entryId),
    onSuccess: (req) => {
      notify(`تم إرسال طلب استدعاء للمريض ${req.patientName} إلى السكرتارية`)
      setPendingCallPatient(null)
      invalidate()
    },
    onError: (err) => {
      const msg = apiErrorMessage(err)
      notify(msg, "error")
      if ((err as ApiError)?.code === "DOCUMENTATION_REQUIRED" || msg.includes("توثيق")) {
        setShowReviewModal(true)
      }
    },
  })

  const cancelCallRequestMutation = useMutation({
    mutationFn: (id: string) => queueApi.cancelCallRequest(id),
    onSuccess: (req) => {
      notify(`تم إلغاء طلب استدعاء ${req.patientName}`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  useCallRequest((event) => {
    if (event.type === "approved") {
      notify(`المريض ${event.payload.patientName} جاهز وداخل العيادة الآن`, "success")
      invalidate()
    } else if (event.type === "cancelled") {
      notify(`تم إلغاء طلب استدعاء ${event.payload.patientName}`)
      invalidate()
    }
  })

  const callNextMutation = useMutation({
    mutationFn: () => queueApi.callNext(),
    onSuccess: (entry) => {
      notify(`تم استدعاء ${entry.displayName}`)
      invalidate()
    },
    onError: (err) => {
      const msg = apiErrorMessage(err)
      notify(msg, "error")
      if ((err as ApiError)?.code === "DOCUMENTATION_REQUIRED" || msg.includes("توثيق")) {
        setShowReviewModal(true)
      }
    },
  })

  const skipMutation = useMutation({
    mutationFn: (entryId: string) => queueApi.skip(entryId),
    onSuccess: (entry) => {
      notify(`تم تخطي ${entry.displayName} مؤقتًا`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const complimentaryMutation = useMutation({
    mutationFn: (entryId: string) =>
      billingApi.complimentary({ queueEntryId: entryId }),
    onSuccess: () => {
      notify("تم تحويل الزيارة إلى استشارة مجانية")
      setShowComplimentary(false)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const completeMutation = useMutation({
    mutationFn: (entryId: string) => queueApi.complete(entryId),
    onSuccess: (entry) => {
      notify(`اكتملت زيارة ${entry.displayName} — أُنشئت فاتورة بانتظار التحصيل`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const emergencyCount = waiting.filter((w) => w.isEmergency).length
  const draftsCount =
    (unsignedQuery.data?.staleDrafts.length ?? 0) +
    (unsignedQuery.data?.completedWithoutSigned.filter((c) => !c.hasSignedEncounter).length ?? 0)

  return (
    <>
      <section className="doctor-hero">
        <div>
          <span className="eyebrow light">
            {current
              ? `الجلسة الحالية · بدأت ${new Intl.DateTimeFormat("ar-EG", { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(current.calledAt as string))}`
              : "لا جلسة جارية حاليًا"}
          </span>
          <h2>{current?.displayName ?? "استدعِ المريض التالي"}</h2>
          <p>
            {current ? (
              <>
                {current.patientId.slice(-6)} · {current.isEmergency ? "حالة طارئة" : "زيارة اليوم"} ·{" "}
                <ElapsedTimer calledAt={current.calledAt as string} /> منذ الاستدعاء
              </>
            ) : (
              "اضغط استدعاء التالي لبدء جلسة جديدة مع أول مريض في الطابور."
            )}
          </p>
          <div className="hero-actions">
            {current ? (
              <>
                <AppButton variant="secondary" icon="file" onClick={() => navigate(`/doctor/patients/${current.patientId}`)}>
                  فتح الملف الطبي
                </AppButton>
                <AppButton
                  variant="outline"
                  icon="mic"
                  onClick={() =>
                    navigate(
                      `/doctor/session?patient=${current.patientId}&entry=${current.entryId}`,
                    )
                  }
                >
                  متابعة الجلسة
                </AppButton>
                <AppButton
                  variant="danger"
                  icon="check"
                  onClick={() => completeMutation.mutate(current.entryId)}
                  disabled={completeMutation.isPending}
                >
                  {completeMutation.isPending ? "جارٍ الإنهاء..." : "إنهاء الزيارة"}
                </AppButton>
              </>
            ) : (
              <AppButton
                icon="phone"
                onClick={handleOpenCallReview}
                disabled={
                  Boolean(queue?.activeCallRequest) ||
                  createCallRequestMutation.isPending ||
                  waiting.length === 0
                }
              >
                {queue?.activeCallRequest
                  ? "بانتظار دخول المريض..."
                  : createCallRequestMutation.isPending
                    ? "جارٍ إرسال الطلب..."
                    : "طلب المريض التالي"}
              </AppButton>
            )}
          </div>
        </div>
        <div className="session-time">
          <span className="pulse-ring">
            <Icon name="clock" size={23} />
          </span>
          <span>
            <small>مدة الجلسة</small>
            <strong>{current ? <ElapsedTimer calledAt={current.calledAt as string} /> : "٠٠:٠٠"}</strong>
            <em>{current ? "جارية الآن" : "بانتظار الاستدعاء"}</em>
          </span>
        </div>
        <div className="hero-orb orb_one" />
        <div className="hero-orb orb_two" />
      </section>

      <section className="stats-grid four doctor-stats">
        <StatCard
          label="في الانتظار"
          value={arNum(waiting.length)}
          hint={emergencyCount > 0 ? `بينهم ${arNum(emergencyCount)} حالة ذات أولوية` : "لا حالات طارئة"}
          icon="clock"
          tone="amber"
        />
        <StatCard
          label="زيارات مكتملة"
          value={arNum(completed.length)}
          hint={`من أصل ${arNum(entries.length)} اليوم`}
          icon="check"
          tone="mint"
        />
        <StatCard
          label="تقارير للمراجعة"
          value={arNum(draftsCount)}
          hint={
            (unsignedQuery.data?.deferralCount ?? 0) > 0
              ? `${arNum(unsignedQuery.data?.deferralCount ?? 0)} كشف مؤجل التوثيق`
              : "مسودات وزيارات غير موثقة"
          }
          icon="sparkle"
          tone="blue"
        />
        <StatCard
          label="متوسط الجلسة"
          value={arNum(avgSession)}
          suffix="دقيقة"
          hint={completed.length > 0 ? "محسوب من زيارات اليوم" : "من إعدادات العيادة"}
          icon="chart"
          tone="blue"
        />
      </section>

      <div className="doctor-grid">
        <section className="card doctor-queue">
          <div className="card-header">
            <div>
              <span className="section-kicker">قائمة الانتظار</span>
              <h3>المرضى القادمون</h3>
            </div>
            <AppButton
              icon="phone"
              onClick={handleOpenCallReview}
              disabled={
                Boolean(queue?.activeCallRequest) ||
                createCallRequestMutation.isPending ||
                waiting.length === 0
              }
            >
              {queue?.activeCallRequest ? "بانتظار الدخول..." : "طلب التالي"}
            </AppButton>
          </div>

          {queue?.activeCallRequest && (
            <div className="call-request-banner">
              <div className="call-request-info">
                <div className="call-request-icon">
                  <Icon name="phone" size={18} />
                </div>
                <div>
                  <strong className="call-request-title-row" style={{ fontSize: "15px", color: "var(--text-strong)" }}>
                    الدكتور مستني مريض ({queue.activeCallRequest.patientName})
                  </strong>
                  <p className="call-request-text">
                    تم إرسال الطلب إلى السكرتارية. بانتظار تجهيز المريض وتأكيد دخوله للعيادة...
                  </p>
                </div>
              </div>
              <div className="call-request-actions">
                <AppButton
                  variant="outline"
                  onClick={() => cancelCallRequestMutation.mutate(queue.activeCallRequest!.id)}
                  disabled={cancelCallRequestMutation.isPending}
                >
                  إلغاء الطلب
                </AppButton>
              </div>
            </div>
          )}
          {isLoading && <p>جارٍ تحميل الطابور…</p>}
          {!isLoading && waiting.length === 0 && (
            <p>لا مرضى في الانتظار — سيظهر القادمون هنا تلقائيًا.</p>
          )}
          {waiting.map((p, i) => (
            <div
              className={`doctor-queue-row ${p.isEmergency ? "emergency" : ""}`}
              key={p.entryId}
            >
              <span className="queue-number">{arNum(i + 1)}</span>
              <span className={`patient-avatar a${i % 4}`}>{p.displayName.charAt(0)}</span>
              <div>
                <strong>{p.displayName}</strong>
                <small>
                  {p.patientId.slice(-6)} ·{" "}
                  {p.isEmergency ? "حالة طارئة" : "زيارة اليوم"}
                </small>
              </div>
              {p.isEmergency && (
                <span className="emergency-tag">
                  <Icon name="alert" size={13} /> أولوية
                </span>
              )}
              <span className="waiting-label">
                <Icon name="clock" size={14} /> {arNum(p.estimatedWaitMin)} د
              </span>
              <button
                title="تخطي مؤقت"
                onClick={() => skipMutation.mutate(p.entryId)}
                disabled={skipMutation.isPending}
              >
                تخطي
              </button>
            </div>
          ))}
        </section>
        <aside className="side-stack">
          <section className="card review-card">
            <div className="ai-icon">
              <Icon name="sparkle" />
            </div>
            <span className="section-kicker">المراجعة والتوثيق</span>
            <h3>
              {draftsCount > 0
                ? `${arNum(draftsCount)} ${draftsCount === 1 ? "كشف بحاجة للتوثيق" : "كشوفات بحاجة للتوثيق"}`
                : "جميع الكشوفات موثقة"}
            </h3>
            <p>
              {(unsignedQuery.data?.deferralCount ?? 0) > 0
                ? `هناك ${arNum(unsignedQuery.data?.deferralCount ?? 0)} حالة توثيق مؤجلة تتطلب المتابعة.`
                : "راجع كشوفات اليوم غير الموقعة والتأجيلات المسجلة."}
            </p>
            <AppButton variant="secondary" onClick={() => setShowReviewModal(true)}>
              مراجعة
            </AppButton>
          </section>
        </aside>
      </div>


      {showReviewModal && (
        <ReviewModal
          data={unsignedQuery.data}
          onClose={() => setShowReviewModal(false)}
          onRefresh={() => {
            void unsignedQuery.refetch()
            invalidate()
          }}
        />
      )}

      {showComplimentary && (
        <Modal
          title="تحويل زيارة إلى استشارة مجانية"
          subtitle="اختر زيارة من طابور اليوم — يُسجل التحويل باسمك في السجل المالي."
          onClose={() => setShowComplimentary(false)}
        >
          <div className="data-table">
            {waiting.length === 0 && (
              <div className="data-row">
                <span>لا توجد زيارات متاحة للتحويل.</span>
              </div>
            )}
            {waiting.map((e, i) => (
              <button
                key={e.entryId}
                className="data-row"
                onClick={() => complimentaryMutation.mutate(e.entryId)}
                disabled={complimentaryMutation.isPending}
              >
                <strong>{e.displayName}</strong>
                <span className={`patient-avatar a${i % 4}`}>{e.displayName.charAt(0)}</span>
                <span>في الانتظار</span>
                <Icon name="chevron" size={16} />
              </button>
            ))}
          </div>
          <div className="modal-actions">
            <AppButton variant="outline" onClick={() => setShowComplimentary(false)}>
              إلغاء
            </AppButton>
          </div>
        </Modal>
      )}

      {pendingCallPatient && (
        <Modal
          title="مراجعة بيانات المريض قبل الاستدعاء"
          subtitle="خطوة مراجعة إلزامية للتحقق من المريض القادم قبل دخول الجلسة."
          onClose={() => setPendingCallPatient(null)}
        >
          <div className="review-patient-panel" style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                background: "oklch(0.72 0.19 290 / 0.14)",
                padding: "16px",
                borderRadius: "16px",
                border: "1px solid oklch(0.72 0.19 290 / 0.4)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <span style={{ fontSize: "13px", color: "oklch(1 0 0 / 0.72)" }}>
                    المريض التالي في الطابور
                  </span>
                  <h3
                    style={{
                      margin: "3px 0 0",
                      color: "var(--text-strong)",
                      fontSize: "19px",
                    }}
                  >
                    {pendingCallPatient.displayName}
                  </h3>
                </div>
                <span
                  style={{
                    fontSize: "12.5px",
                    background: "oklch(1 0 0 / 0.12)",
                    padding: "5px 11px",
                    borderRadius: "999px",
                    border: "1px solid oklch(1 0 0 / 0.25)",
                    color: "oklch(1 0 0 / 0.85)",
                  }}
                >
                  معرّف: {pendingCallPatient.patientId.slice(-6)}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <small style={{ color: "oklch(1 0 0 / 0.72)", display: "block", fontSize: "12.5px" }}>
                    العمر
                  </small>
                  <strong style={{ fontSize: "15.5px", color: "var(--text-strong)" }}>
                    {pendingPatientDetailQuery.isLoading
                      ? "جارٍ التحميل..."
                      : pendingPatientDetailQuery.data?.dateOfBirth
                        ? `${arNum(ageFromDob(pendingPatientDetailQuery.data.dateOfBirth) ?? 0)} سنة`
                        : "غير مسجل"}
                  </strong>
                </div>
                <div>
                  <small style={{ color: "oklch(1 0 0 / 0.72)", display: "block", fontSize: "12.5px" }}>
                    آخر زيارة
                  </small>
                  <strong style={{ fontSize: "15.5px", color: "var(--text-strong)" }}>
                    {pendingPatientDetailQuery.isLoading
                      ? "جارٍ التحميل..."
                      : pendingPatientDetailQuery.data?.pastVisitTimestamps?.[0]
                        ? arAgo(pendingPatientDetailQuery.data.pastVisitTimestamps[0])
                        : "زيارة أولى (لا زيارات سابقة)"}
                  </strong>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <span
                style={{
                  fontSize: "13.5px",
                  fontWeight: 700,
                  color: "var(--text-strong)",
                }}
              >
                تنبيهات المريض:
              </span>

              {pendingCallPatient.isEmergency && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "oklch(0.74 0.16 15 / 0.14)",
                    border: "1px solid oklch(0.74 0.16 15 / 0.45)",
                    color: "oklch(0.86 0.12 15)",
                    padding: "11px 15px",
                    borderRadius: "12px",
                    fontSize: "13.5px",
                    fontWeight: 500,
                  }}
                >
                  <Icon name="alert" size={16} />
                  <span>
                    <strong>حالة طارئة:</strong>{" "}
                    {emergencyReasonLabel[pendingCallPatient.emergencyReasonCode ?? ""] ||
                      "تم تصنيف الحالة كأولوية قصوى"}
                  </span>
                </div>
              )}

              {pendingCallPatient.debtAlert && pendingCallPatient.debtAlert.outstandingMinor > 0 && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "oklch(0.8 0.15 90 / 0.14)",
                    border: "1px solid oklch(0.8 0.15 90 / 0.45)",
                    color: "oklch(0.9 0.11 90)",
                    padding: "11px 15px",
                    borderRadius: "12px",
                    fontSize: "13.5px",
                    fontWeight: 500,
                  }}
                >
                  <Icon name="wallet" size={16} />
                  <span>
                    <strong>رصيد مستحق غير مسدد:</strong>{" "}
                    {moneyMinor(pendingCallPatient.debtAlert.outstandingMinor)}
                  </span>
                </div>
              )}

              {!pendingCallPatient.isEmergency &&
                (!pendingCallPatient.debtAlert ||
                  pendingCallPatient.debtAlert.outstandingMinor <= 0) && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      background: "oklch(0.78 0.14 180 / 0.14)",
                      border: "1px solid oklch(0.78 0.14 180 / 0.45)",
                      color: "oklch(0.86 0.12 165)",
                      padding: "11px 15px",
                      borderRadius: "12px",
                      fontSize: "13.5px",
                    }}
                  >
                    <Icon name="check" size={16} />
                    <span>لا توجد تنبيهات طارئة أو ديون مستحقة على المريض.</span>
                  </div>
                )}
            </div>

            <div className="modal-actions" style={{ marginTop: "8px" }}>
              <AppButton variant="outline" type="button" onClick={() => setPendingCallPatient(null)}>
                إلغاء
              </AppButton>
              <AppButton
                icon="phone"
                onClick={() => {
                  createCallRequestMutation.mutate({ entryId: pendingCallPatient.entryId })
                }}
                disabled={createCallRequestMutation.isPending}
              >
                {createCallRequestMutation.isPending ? "جارٍ إرسال الطلب..." : "طلب المريض التالي"}
              </AppButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

/**
 * Isolated 1s session clock — re-renders only this tiny subtree instead of
 * the whole dashboard every second (was a full 790-line tree re-render).
 */
function ElapsedTimer({ calledAt }: { calledAt: string }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(calledAt).getTime()) / 1000)),
  )
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(calledAt).getTime()) / 1000)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [calledAt])
  return <>{arTimer(elapsed)}</>
}
