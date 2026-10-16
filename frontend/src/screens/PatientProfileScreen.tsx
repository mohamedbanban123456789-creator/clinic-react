/**
 * Patient profile — design preserved; role-adaptive content:
 *  - Doctor: clinical chart (SOAP encounters timeline), reports, medications,
 *    confidential vault notes (encrypted at rest, doctor-only).
 *  - Secretary: administrative view only — demographics, balance lines, and
 *    invoices. The secretary view NEVER requests EHR or vault endpoints
 *    (backend would 403; the frontend never even asks).
 */

import { useState } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { patientsApi } from "@/api/patients"
import { ehrApi } from "@/api/ehr"
import { vaultApi } from "@/api/vault"
import { intercomApi } from "@/api/intercom"
import { queueApi } from "@/api/queue"
import { apiErrorMessage } from "@/api/client"
import { AppButton, Icon, Modal, SkeletonBlock, useToast } from "@/components/ui"
import { useAuth } from "@/auth/AuthContext"
import {
  ageFromDob,
  arAgo,
  arDate,
  arNum,
  arDateTime,
  moneyMinor,
  formatPhone,
} from "@/lib/format"
import { invoiceStatusLabel, cessationReasonOptions } from "@/lib/constants"
import type { DiagnosisEntryDto } from "@/api/types"

const dxLabel = (d: DiagnosisEntryDto): string =>
  typeof d === "string" ? d : `${d.name}${d.code ? ` (${d.code})` : ""}`

const dxKey = (d: DiagnosisEntryDto, i: number): string =>
  typeof d === "string" ? `${d}-${i}` : `${d.name}-${d.code ?? i}`
import type { VaultNoteDto } from "@/api/types"

function TimelineItem({
  date,
  type,
  tone,
  children,
}: {
  date: string
  type: string
  tone: string
  children: React.ReactNode
}) {
  return (
    <article className="timeline-item">
      <div className={`timeline-dot ${tone}`} />
      <div className="timeline-content">
        <div>
          <span className="timeline-type">{type}</span>
          <time>{date}</time>
        </div>
        {children}
      </div>
    </article>
  )
}

function VaultPanel({
  patientId,
  onClose,
}: {
  patientId: string
  onClose: () => void
}) {
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const [newNote, setNewNote] = useState("")

  const notesQuery = useQuery({
    queryKey: ["vault", patientId],
    queryFn: () => vaultApi.list(patientId, 20),
  })

  const addMutation = useMutation({
    mutationFn: () => vaultApi.add(patientId, newNote.trim()),
    onSuccess: () => {
      notify("حُفظت الملاحظة في المساحة المحمية")
      setNewNote("")
      void queryClient.invalidateQueries({ queryKey: ["vault", patientId] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const shredMutation = useMutation({
    mutationFn: (noteId: string) => vaultApi.shred(noteId),
    onSuccess: () => {
      notify("تم إتلاف الملاحظة نهائيًا")
      void queryClient.invalidateQueries({ queryKey: ["vault", patientId] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const notes = notesQuery.data?.notes ?? []

  return (
    <Modal
      title="المساحة المحمية — ملاحظات سرية للغاية"
      subtitle="مرئية للطبيب فقط · مشفّرة في التخزين · الاستقبال لا يراها مطلقًا"
      onClose={onClose}
    >
      <form
        className="modal-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (newNote.trim().length > 0) addMutation.mutate()
        }}
      >
        <label className="field">
          <span>ملاحظة سريرية سرية جديدة</span>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="سياق حساس يخص العلاج — لا يظهر في أي مساحة أخرى..."
            rows={3}
          />
        </label>
        <div className="modal-actions">
          <AppButton type="submit" icon="lock" disabled={addMutation.isPending || !newNote.trim()}>
            {addMutation.isPending ? "جارٍ الحفظ..." : "حفظ مشفّرة"}
          </AppButton>
        </div>
      </form>
      <div className="data-table" style={{ marginTop: "10px" }}>
        {notesQuery.isLoading && <div className="data-row"><span>جارٍ التحميل…</span></div>}
        {notes.length === 0 && !notesQuery.isLoading && (
          <div className="data-row"><span>لا ملاحظات سرية بعد.</span></div>
        )}
        {notes.map((note) =>
          "shredded" in note ? (
            <div className="data-row" key={note.noteId} style={{ cursor: "default", opacity: 0.55 }}>
              <strong>#{arNum(note.seq)}</strong>
              <span>أُتلفت نهائيًا {arDate(note.shreddedAt)}</span>
              <span />
              <span />
            </div>
          ) : (
            <div className="data-row" key={note.noteId} style={{ cursor: "default" }}>
              <strong>#{arNum(note.seq)}</strong>
              <span style={{ whiteSpace: "pre-wrap", maxWidth: "420px" }}>{note.content}</span>
              <span>{arDate(note.noteDate)}</span>
              <button
                className="row-action"
                onClick={() => shredMutation.mutate(note.noteId)}
                disabled={shredMutation.isPending}
                title="إتلاف نهائي بلا استرجاع"
              >
                إتلاف
                <Icon name="alert" size={15} />
              </button>
            </div>
          ),
        )}
      </div>
    </Modal>
  )
}

export default function PatientProfileScreen() {
  const { id = "" } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notify } = useToast()
  const isDoctor = user?.role === "DOCTOR"
  const [tab, setTab] = useState(isDoctor ? "timeline" : "financial")
  const [vaultOpen, setVaultOpen] = useState(false)
  const [followUpNote, setFollowUpNote] = useState("")

  const patientQuery = useQuery({
    queryKey: ["patient", id],
    queryFn: () => patientsApi.get(id),
    enabled: Boolean(id),
  })

  const balanceQuery = useQuery({
    queryKey: ["patient-balance", id],
    queryFn: () => patientsApi.balance(id),
    enabled: Boolean(id),
  })

  const chartQuery = useQuery({
    queryKey: ["chart", id],
    queryFn: () => ehrApi.chart(id),
    enabled: Boolean(id) && isDoctor,
  })

  const medsQuery = useQuery({
    queryKey: ["medications", id],
    queryFn: () => ehrApi.medications(id),
    enabled: Boolean(id) && isDoctor,
  })

  const invoicesQuery = useQuery({
    queryKey: ["billing", "patient", id],
    queryFn: () => patientsApi.invoices(id, 100),
    enabled: Boolean(id),
  })

  // Today's queue entry for this patient (needed for DOCTOR_FOLLOWUP messages).
  const queueQuery = useQuery({
    queryKey: ["queue", "current"],
    queryFn: () => queueApi.list(),
    enabled: isDoctor,
  })
  const patientEntry = (queueQuery.data?.entries ?? []).find(
    (e) => e.patientId === id,
  )

  const followUpMutation = useMutation({
    mutationFn: (entryId: string) =>
      intercomApi.send({
        type: "DOCTOR_FOLLOWUP",
        relatedQueueEntryId: entryId,
        followUp: { followUpType: "GENERAL", window: "NEXT_VISIT" },
        text: followUpNote.trim() || undefined,
      }),
    onSuccess: () => {
      notify("أُرسل طلب متابعة للاستقبال")
      setFollowUpNote("")
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const patient = patientQuery.data

  if (patientQuery.isLoading) {
    return (
      <section className="card">
        <SkeletonBlock lines={4} />
      </section>
    )
  }

  if (patientQuery.isError || !patient) {
    return (
      <section className="card form-card">
        <div className="step-header">
          <span className="step-no">!</span>
          <div>
            <h2>تعذر فتح الملف</h2>
            <p>{apiErrorMessage(patientQuery.error)}</p>
          </div>
        </div>
        <AppButton variant="outline" onClick={() => navigate(-1)}>
          العودة
        </AppButton>
      </section>
    )
  }

  const age = ageFromDob(patient.dateOfBirth)
  const totalVisits = patient.pastVisitTimestamps.length
  const encounters = chartQuery.data?.encounters ?? []
  const medications = medsQuery.data?.medications ?? []
  const activeMeds = medications.filter((m) => m.status === "ACTIVE")
  const stoppedMeds = medications.filter((m) => m.status === "DISCONTINUED")
  const outstanding = balanceQuery.data?.outstandingMinor ?? 0
  const invoices = invoicesQuery.data?.data ?? []

  return (
    <>
      <section className="card patient-header-card">
        <div className="patient-heading">
          <span className="patient-avatar xl">{patient.fullName.charAt(0)}</span>
          <div>
            <span className="id-label">ملف {patient.id.slice(-6)}</span>
            <h2>{patient.fullName}</h2>
            <p>
              {age !== null ? `${arNum(age)} سنة · ` : ""}
              {patient.physicalAddress ?? "العنوان غير مسجل"} ·{" "}
              {patient.phone ? (
                <span className="phone-display">{formatPhone(patient.phone, null, isDoctor ? "DOCTOR" : "SECRETARY")}</span>
              ) : (
                "بدون هاتف"
              )}
            </p>
          </div>
        </div>
        <div className="patient-summary">
          <span>
            <small>أول زيارة مسجلة</small>
            <strong>{arDate(patient.createdAt)}</strong>
          </span>
          <span>
            <small>إجمالي الزيارات</small>
            <strong>{arNum(totalVisits)} زيارة</strong>
          </span>
          <span>
            <small>آخر زيارة</small>
            <strong>{patient.lastVisitAt ? arAgo(patient.lastVisitAt) : "—"}</strong>
          </span>
        </div>
        <div className="header-buttons">
          {isDoctor && (
            <>
              <AppButton
                variant="outline"
                icon="file"
                onClick={() =>
                  encounters[0] && navigate(`/doctor/soap?encounter=${encounters[0].encounterId}`)
                }
                disabled={encounters.length === 0}
              >
                تقرير سابق
              </AppButton>
              <AppButton
                icon="mic"
                onClick={() => navigate(`/doctor/session?patient=${patient.id}`)}
              >
                بدء جلسة جديدة
              </AppButton>
            </>
          )}
          {!isDoctor && outstanding > 0 && (
            <AppButton icon="wallet" onClick={() => navigate(`/secretary/payments?patient=${patient.id}`)}>
              تحصيل الرصيد ({moneyMinor(outstanding)})
            </AppButton>
          )}
        </div>
      </section>

      <div className="profile-layout">
        <section className="card profile-main">
          <div className="tabs">
            {isDoctor && (
              <>
                <button
                  className={tab === "timeline" ? "active" : ""}
                  onClick={() => setTab("timeline")}
                >
                  السجل الزمني
                </button>
                <button
                  className={tab === "reports" ? "active" : ""}
                  onClick={() => setTab("reports")}
                >
                  التقارير
                </button>
                <button
                  className={tab === "meds" ? "active" : ""}
                  onClick={() => setTab("meds")}
                >
                  الأدوية
                </button>
              </>
            )}
            {!isDoctor && (
              <>
                <button
                  className={tab === "financial" ? "active" : ""}
                  onClick={() => setTab("financial")}
                >
                  الفواتير والرصيد
                </button>
                <button
                  className={tab === "visits" ? "active" : ""}
                  onClick={() => setTab("visits")}
                >
                  الزيارات
                </button>
              </>
            )}
          </div>

          {isDoctor && tab === "timeline" && (
            <div className="timeline">
              {encounters.length === 0 && (
                <div className="empty-state">
                  <Icon name="file" size={34} />
                  <h3>لا سجل سريري بعد</h3>
                  <p>سيظهر السجل الزمني بعد أول تقرير معتمد.</p>
                </div>
              )}
              {encounters.map((enc, i) => (
                <TimelineItem
                  key={enc.encounterId}
                  date={arDate(enc.visitDate ?? enc.signedAt)}
                  type={
                    enc.source === "SCRIBE" ? "توثيق بمساعدة AI" : "زيارة متابعة"
                  }
                  tone={["violet", "teal", "blue", "amber"][i % 4]}
                >
                  <p>
                    {(enc.soap.A ?? "").slice(0, 160)}
                    {(enc.soap.A ?? "").length > 160 ? "…" : ""}
                  </p>
                  <div className="timeline-tags">
                    <span>SOAP معتمد</span>
                    {enc.diagnoses.slice(0, 2).map((d, i) => (
                      <span key={dxKey(d, i)}>{dxLabel(d)}</span>
                    ))}
                  </div>
                  <button
                    className="text-link"
                    onClick={() => navigate(`/doctor/soap?encounter=${enc.encounterId}`)}
                  >
                    فتح التقرير <Icon name="arrow" size={14} />
                  </button>
                </TimelineItem>
              ))}
            </div>
          )}

          {isDoctor && tab === "reports" && (
            <div className="empty-state">
              <Icon name="file" size={34} />
              <h3>تقارير المريض</h3>
              <p>
                {encounters.length > 0
                  ? `${arNum(encounters.length)} تقرير معتمد في السجل.`
                  : "لا تقارير بعد."}
              </p>
              {encounters[0] && (
                <AppButton onClick={() => navigate(`/doctor/soap?encounter=${encounters[0].encounterId}`)}>
                  فتح أحدث تقرير
                </AppButton>
              )}
            </div>
          )}

          {isDoctor && tab === "meds" && (
            <div className="empty-state">
              <Icon name="pill" size={34} />
              <h3>الخطة الدوائية الحالية</h3>
              <p>
                {activeMeds.length > 0
                  ? `${arNum(activeMeds.length)} دواء حالي و${arNum(stoppedMeds.length)} متوقف.`
                  : "لا أدوية مسجلة."}
              </p>
              <AppButton onClick={() => navigate(`/doctor/medications?patient=${patient.id}`)}>
                عرض سجل الأدوية
              </AppButton>
            </div>
          )}

          {!isDoctor && tab === "financial" && (
            <div className="data-table">
              <div className="data-head">
                <span>الفاتورة</span>
                <span>التاريخ</span>
                <span>المستحق</span>
                <span>المحصّل</span>
                <span>المتبقي</span>
                <span>الحالة</span>
              </div>
              {invoices.length === 0 && (
                <div className="data-row">
                  <span>لا فواتير مسجلة.</span>
                </div>
              )}
              {invoices.map((inv) => (
                <div className="data-row" key={inv.invoiceId} style={{ cursor: "default" }}>
                  <strong>{inv.invoiceId.slice(-6).toUpperCase()}</strong>
                  <span>{arDate(inv.createdAt)}</span>
                  <span>{moneyMinor(inv.finalFeeMinor)}</span>
                  <span>{moneyMinor(inv.collectedMinor)}</span>
                  <span className={inv.outstandingMinor > 0 ? "due-text" : ""}>
                    {moneyMinor(inv.outstandingMinor)}
                  </span>
                  <span className="method-pill">{invoiceStatusLabel[inv.status]}</span>
                </div>
              ))}
            </div>
          )}

          {!isDoctor && tab === "visits" && (
            <div className="timeline">
              {patient.pastVisitTimestamps.length === 0 && (
                <div className="empty-state">
                  <Icon name="calendar" size={34} />
                  <h3>لا زيارات سابقة</h3>
                  <p>سيظهر سجل الزيارات بعد أول حضور.</p>
                </div>
              )}
              {[...patient.pastVisitTimestamps].reverse().map((ts, i) => (
                <TimelineItem key={ts} date={arDate(ts)} type="زيارة" tone={["violet", "teal", "blue", "amber"][i % 4]}>
                  <p>حضور مسجل في الطابور — التفاصيل السريرية متاحة للطبيب فقط.</p>
                </TimelineItem>
              ))}
            </div>
          )}
        </section>

        <aside className="side-stack">
          <section className="card care-summary">
            <h3>ملخص المتابعة</h3>
            {isDoctor ? (
              <>
                <span>
                  <Icon name="heart" />
                  <span>
                    <small>محور المتابعة</small>
                    <strong>
                      {encounters[0] ? dxLabel(encounters[0].diagnoses[0] ?? "يحدد بعد أول تقرير") : "يحدد بعد أول تقرير"}
                    </strong>
                  </span>
                </span>
                <span>
                  <Icon name="calendar" />
                  <span>
                    <small>آخر تقرير معتمد</small>
                    <strong>
                      {encounters[0]?.signedAt ? arDate(encounters[0].signedAt) : "—"}
                    </strong>
                  </span>
                </span>
                <span>
                  <Icon name="pill" />
                  <span>
                    <small>الأدوية الحالية</small>
                    <strong>{arNum(activeMeds.length)} دواء مسجل</strong>
                  </span>
                </span>
              </>
            ) : (
              <>
                <span>
                  <Icon name="wallet" />
                  <span>
                    <small>الرصيد المستحق</small>
                    <strong>{moneyMinor(outstanding)}</strong>
                  </span>
                </span>
                <span>
                  <Icon name="receipt" />
                  <span>
                    <small>فواتير غير مسددة</small>
                    <strong>
                      {arNum(invoices.filter((i) => i.outstandingMinor > 0).length)} فاتورة
                    </strong>
                  </span>
                </span>
                <span>
                  <Icon name="users" />
                  <span>
                    <small>حالة الملف</small>
                    <strong>
                      {patient.registrationStatus === "COMPLETE" ? "مكتمل" : "غير مكتمل"}
                    </strong>
                  </span>
                </span>
              </>
            )}
          </section>

          {isDoctor && (
            <>
              <section className="card confidential-card">
                <div className="confidential-head">
                  <span>
                    <Icon name="lock" size={18} />
                  </span>
                  <div>
                    <h3>ملاحظات سرية للغاية</h3>
                    <p>مرئية للطبيب فقط</p>
                  </div>
                </div>
                <p>
                  مساحة مشفّرة للملاحظات الحساسة — لا تظهر في أي مساحة أخرى ولا
                  يمكن للاستقبال الوصول إليها.
                </p>
                <button onClick={() => setVaultOpen(true)}>
                  <Icon name="eye" size={15} /> فتح المساحة المحمية
                </button>
              </section>

              <section className="card care-summary">
                <h3>طلب متابعة</h3>
                <label className="field">
                  <span>ملاحظة المتابعة (تُرسل للاستقبال)</span>
                  <input
                    value={followUpNote}
                    onChange={(e) => setFollowUpNote(e.target.value)}
                    placeholder="مثال: الاتصال لتأكيد موعد بعد أسبوعين"
                  />
                </label>
                <AppButton
                  variant="secondary"
                  icon="send"
                  onClick={() => patientEntry && followUpMutation.mutate(patientEntry.entryId)}
                  disabled={followUpMutation.isPending || !patientEntry}
                  title={patientEntry ? "" : "المريض غير مسجل في طابور اليوم — اطلب المتابعة من شاشة التواصل"}
                >
                  {followUpMutation.isPending
                    ? "جارٍ الإرسال..."
                    : patientEntry
                      ? "إرسال طلب متابعة"
                      : "المريض خارج طابور اليوم"}
                </AppButton>
              </section>
            </>
          )}
        </aside>
      </div>

      {vaultOpen && <VaultPanel patientId={patient.id} onClose={() => setVaultOpen(false)} />}
    </>
  )
}
