/**
 * Doctor dashboard — design preserved; live session context from the queue
 * (IN_CONSULTATION entry), call-next / skip wired to real endpoints, live
 * session timer, review card fed by supervision/unsigned-notes, and the
 * doctor's floating chat.
 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/auth/AuthContext"
import { useQueue, useQueueInvalidation } from "@/hooks/useQueue"
import { queueApi } from "@/api/queue"
import { supervisionApi, settingsApi } from "@/api/admin"
import { billingApi } from "@/api/billing"
import { patientsApi } from "@/api/patients"
import { apiErrorMessage, ApiError } from "@/api/client"
import { AppButton, Icon, Modal, StatCard, useToast } from "@/components/ui"
import { FloatingChat } from "@/components/Conversation"
import { arNum, arTimer, arDate, ageFromDob, arAgo, moneyMinor } from "@/lib/format"
import { emergencyReasonLabel } from "@/lib/constants"
import type { UnsignedNotesDto, QueueEntryDto } from "@/api/types"

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
          <h4 style={{ margin: "0 0 0.5rem 0", color: "#1e1b4b" }}>
            كشوفات بانتظار التوثيق والتوقيع ({arNum(unsignedList.length)})
          </h4>
          {unsignedList.length === 0 ? (
            <p style={{ color: "#6b7280", margin: 0, fontSize: "0.9rem" }}>
              جميع كشوفات اليوم موثقة وموقعة بنجاح.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
              {unsignedList.map((item) => (
                <div
                  key={item.queueEntryId}
                  style={{
                    padding: "0.75rem",
                    borderRadius: "8px",
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <strong style={{ fontSize: "1rem" }}>{item.displayName}</strong>
                      <span style={{ fontSize: "0.8rem", color: "#6b7280", marginRight: "0.5rem" }}>
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
                    <div style={{ marginTop: "0.75rem", padding: "0.5rem", background: "#fff", borderRadius: "6px", border: "1px solid #e5e7eb" }}>
                      <label style={{ display: "block", fontSize: "0.85rem", fontWeight: "bold", marginBottom: "0.25rem" }}>
                        سبب تأجيل التوثيق (مطلوب):
                      </label>
                      <input
                        value={deferReason}
                        onChange={(e) => setDeferReason(e.target.value)}
                        placeholder="اكتب سبب التأجيل (مثال: بانتظار نتائج التحاليل، انشغال طارئ)..."
                        style={{ width: "100%", padding: "0.4rem 0.6rem", borderRadius: "4px", border: "1px solid #d1d5db", fontSize: "0.85rem" }}
                      />
                      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", justifyContent: "flex-end" }}>
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
            <h4 style={{ margin: "0 0 0.5rem 0", color: "#b45309" }}>
              حالات التوثيق المؤجلة ({arNum(deferredList.length)})
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {deferredList.map((item) => (
                <div
                  key={item.queueEntryId}
                  style={{
                    padding: "0.6rem 0.75rem",
                    borderRadius: "6px",
                    background: "#fffbeb",
                    border: "1px solid #fde68a",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <strong>{item.displayName}</strong>
                    <div style={{ fontSize: "0.8rem", color: "#78350f" }}>
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
  const { entries, isLoading, queueVersion } = useQueue()
  const invalidate = useQueueInvalidation()
  const [chatOpen, setChatOpen] = useState(false)
  const [showComplimentary, setShowComplimentary] = useState(false)
  const [showReviewModal, setShowReviewModal] = useState(false)

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

  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (!current?.calledAt) {
      setElapsed(0)
      return
    }
    const tick = () =>
      setElapsed(Math.floor((Date.now() - new Date(current.calledAt as string).getTime()) / 1000))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [current?.calledAt])

  const [pendingCallPatient, setPendingCallPatient] = useState<QueueEntryDto | null>(null)

  const pendingPatientDetailQuery = useQuery({
    queryKey: ["patients", pendingCallPatient?.patientId],
    queryFn: () => patientsApi.get(pendingCallPatient!.patientId),
    enabled: !!pendingCallPatient?.patientId,
  })

  const handleOpenCallReview = () => {
    if (waiting.length === 0) return
    setPendingCallPatient(waiting[0])
  }

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
            {current
              ? `${current.patientId.slice(-6)} · ${
                  current.isEmergency ? "حالة طارئة" : "زيارة اليوم"
                } · ${arTimer(elapsed)} منذ الاستدعاء`
              : "اضغط استدعاء التالي لبدء جلسة جديدة مع أول مريض في الطابور."}
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
                disabled={callNextMutation.isPending || waiting.length === 0}
              >
                {callNextMutation.isPending ? "جارٍ الاستدعاء..." : "استدعاء المريض التالي"}
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
            <strong>{current ? arTimer(elapsed) : "٠٠:٠٠"}</strong>
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
          tone="violet"
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
              disabled={callNextMutation.isPending || waiting.length === 0}
            >
              استدعاء التالي
            </AppButton>
          </div>
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

      <FloatingChat
        open={chatOpen}
        setOpen={setChatOpen}
        onComplimentary={() => setShowComplimentary(true)}
      />

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
                background: "var(--color-primary-soft, #EEEBFF)",
                padding: "16px",
                borderRadius: "12px",
                border: "1px solid var(--color-border, #E1E4F0)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "12px",
                }}
              >
                <div>
                  <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #55566F)" }}>
                    المريض التالي في الطابور
                  </span>
                  <h3
                    style={{
                      margin: "2px 0 0",
                      color: "var(--color-text-primary, #29264F)",
                      fontSize: "18px",
                    }}
                  >
                    {pendingCallPatient.displayName}
                  </h3>
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    background: "#FFF",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    border: "1px solid var(--color-border, #E1E4F0)",
                  }}
                >
                  معرّف: {pendingCallPatient.patientId.slice(-6)}
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <div>
                  <small style={{ color: "var(--color-text-muted, #686982)", display: "block" }}>
                    العمر
                  </small>
                  <strong style={{ fontSize: "15px" }}>
                    {pendingPatientDetailQuery.isLoading
                      ? "جارٍ التحميل..."
                      : pendingPatientDetailQuery.data?.dateOfBirth
                        ? `${arNum(ageFromDob(pendingPatientDetailQuery.data.dateOfBirth) ?? 0)} سنة`
                        : "غير مسجل"}
                  </strong>
                </div>
                <div>
                  <small style={{ color: "var(--color-text-muted, #686982)", display: "block" }}>
                    آخر زيارة
                  </small>
                  <strong style={{ fontSize: "15px" }}>
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
                  fontSize: "13px",
                  fontWeight: 600,
                  color: "var(--color-text-primary, #29264F)",
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
                    background: "rgba(180, 35, 54, 0.1)",
                    color: "#B42336",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    fontSize: "13px",
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
                    background: "rgba(180, 83, 9, 0.1)",
                    color: "#B45309",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    fontSize: "13px",
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
                      background: "rgba(8, 127, 140, 0.1)",
                      color: "#087F8C",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      fontSize: "13px",
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
                  setPendingCallPatient(null)
                  callNextMutation.mutate()
                }}
                disabled={callNextMutation.isPending}
              >
                {callNextMutation.isPending ? "جارٍ الاستدعاء..." : "استدعاء المريض الآن"}
              </AppButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
