/**
 * Doctor dashboard — design preserved; live session context from the queue
 * (IN_CONSULTATION entry), call-next / skip wired to real endpoints, live
 * session timer, review card fed by supervision/unsigned-notes, and the
 * doctor's floating chat.
 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useMutation, useQuery } from "@tanstack/react-query"
import { useQueue, useQueueInvalidation } from "@/hooks/useQueue"
import { queueApi } from "@/api/queue"
import { supervisionApi, settingsApi } from "@/api/admin"
import { billingApi } from "@/api/billing"
import { apiErrorMessage } from "@/api/client"
import { AppButton, Icon, Modal, StatCard, useToast } from "@/components/ui"
import { FloatingChat } from "@/components/Conversation"
import { arNum, arTimer } from "@/lib/format"

export default function DoctorDashboard() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const { entries, isLoading, queueVersion } = useQueue()
  const invalidate = useQueueInvalidation()
  const [chatOpen, setChatOpen] = useState(false)
  const [showComplimentary, setShowComplimentary] = useState(false)

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    staleTime: 300_000,
  })

  const unsignedQuery = useQuery({
    queryKey: ["supervision", "unsigned-notes"],
    queryFn: () => supervisionApi.unsignedNotes(),
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

  const callNextMutation = useMutation({
    mutationFn: () => queueApi.callNext(),
    onSuccess: (entry) => {
      notify(`تم استدعاء ${entry.displayName}`)
      invalidate()
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
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
                  current.isEmergency ? "حالة طارئة" : "زيارة في الوردية"
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
              <AppButton icon="phone" onClick={() => callNextMutation.mutate()} disabled={callNextMutation.isPending || waiting.length === 0}>
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
          hint={`من أصل ${arNum(entries.length)} في الوردية`}
          icon="check"
          tone="mint"
        />
        <StatCard
          label="تقارير للمراجعة"
          value={arNum(draftsCount)}
          hint="مسودات وزيارات غير موثقة"
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
            <AppButton icon="phone" onClick={() => callNextMutation.mutate()} disabled={callNextMutation.isPending || waiting.length === 0}>
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
                  {p.isEmergency ? "حالة طارئة" : "زيارة في الوردية"}
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
            <span className="section-kicker">مساعد التوثيق</span>
            <h3>
              {draftsCount > 0
                ? `${arNum(draftsCount)} ${draftsCount === 1 ? "مسودة" : "مسودات"} بانتظار المراجعة`
                : "لا مسودات معلقة"}
            </h3>
            <p>أنهِ مراجعة تقارير SOAP قبل اعتماد سجل اليوم.</p>
            <AppButton variant="secondary" onClick={() => navigate("/doctor/soap")}>
              مراجعة التقارير
            </AppButton>
          </section>
          <section className="card admin-access">
            <Icon name="building" />
            <div>
              <h3>وصول إداري</h3>
              <p>راجع تشغيل الاستقبال والخزينة دون مغادرة مساحة الطبيب.</p>
            </div>
            <button onClick={() => navigate("/secretary")} title="تشغيل العيادة">
              <Icon name="arrow" />
            </button>
          </section>
        </aside>
      </div>

      <FloatingChat
        open={chatOpen}
        setOpen={setChatOpen}
        onComplimentary={() => setShowComplimentary(true)}
      />

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
    </>
  )
}
