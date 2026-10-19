/**
 * Medications screen — design preserved. Real data from
 * GET /ehr/patients/:id/medications (ACTIVE / DISCONTINUED with titration
 * history), real add / discontinue / adjust flows.
 *
 * Honesty note (backend limitation): the backend provides NO drug-interaction
 * checking. Per requirements, no fake safety warnings are shown — the safety
 * card states clearly that interaction review is the doctor's responsibility
 * and the system does not perform automated interaction analysis.
 */

import { useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { listStagger, rise } from "@/clinic/motion"
import { ehrApi } from "@/clinic/api/ehr"
import { patientsApi } from "@/clinic/api/patients"
import { queueApi } from "@/clinic/api/queue"
import { apiErrorMessage } from "@/clinic/api/client"
import { AppButton, Icon, Modal, useToast, SkeletonBlock } from "@/clinic/components/ui"
import { useQueue } from "@/clinic/hooks/useQueue"
import { arDate, arAgo, arNum } from "@/clinic/lib/format"
import { cessationReasonOptions } from "@/clinic/lib/constants"
import type { MedicationDto } from "@/clinic/api/types"

function MedicationCard({
  med,
  onAdjust,
  onDiscontinue,
  busy,
}: {
  med: MedicationDto
  onAdjust: () => void
  onDiscontinue: () => void
  busy: boolean
}) {
  return (
    <div className="med-card">
      <div className="med-icon teal">
        <Icon name="pill" />
      </div>
      <div>
        <div className="med-name">
          <h3>{med.drugName}</h3>
          <span className="active-med">حالي</span>
        </div>
        <p>
          {med.dosage} · {med.frequency}
        </p>
        <small>
          بدأ {arDate(med.startedAt)}
          {med.instructions ? ` · ${med.instructions}` : ""}
        </small>
      </div>
      <button className="text-link" onClick={onAdjust} disabled={busy}>
        تعديل الجرعة
      </button>
      <button className="icon-button" onClick={onDiscontinue} disabled={busy} title="إيقاف الدواء">
        <Icon name="stop" size={16} />
      </button>
    </div>
  )
}

export default function MedicationsScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const { entries } = useQueue()

  const patientParam = params.get("patient")
  const { id } = useParams<{ id: string }>()
  const patientId = id ?? patientParam

  const current = useMemo(
    () =>
      patientId
        ? entries.find((e) => e.patientId === patientId)
        : entries.find((e) => e.status === "IN_CONSULTATION"),
    [entries, patientId],
  )

  const resolvedPatientId = patientId ?? current?.patientId

  const patientQuery = useQuery({
    queryKey: ["patient", resolvedPatientId ?? ""],
    queryFn: () => patientsApi.get(resolvedPatientId!),
    enabled: Boolean(resolvedPatientId),
  })

  const medsQuery = useQuery({
    queryKey: ["medications", resolvedPatientId ?? ""],
    queryFn: () => ehrApi.medications(resolvedPatientId!),
    enabled: Boolean(resolvedPatientId),
  })

  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ drugName: "", dosage: "", frequency: "", instructions: "" })
  const [adjustMed, setAdjustMed] = useState<MedicationDto | null>(null)
  const [adjustForm, setAdjustForm] = useState({ dosage: "", frequency: "", instructions: "" })
  const [stopMed, setStopMed] = useState<MedicationDto | null>(null)
  const [stopReason, setStopReason] = useState("RESOLVED")
  const [stopNote, setStopNote] = useState("")

  const addMutation = useMutation({
    mutationFn: () =>
      ehrApi.addMedication(resolvedPatientId!, {
        drugName: addForm.drugName.trim(),
        dosage: addForm.dosage.trim(),
        frequency: addForm.frequency.trim(),
        instructions: addForm.instructions.trim(),
      }),
    onSuccess: (med) => {
      notify(`أُضيف ${med.drugName} إلى الخطة الدوائية`)
      setShowAdd(false)
      setAddForm({ drugName: "", dosage: "", frequency: "", instructions: "" })
      void queryClient.invalidateQueries({ queryKey: ["medications"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const adjustMutation = useMutation({
    mutationFn: () =>
      ehrApi.adjustMedication(adjustMed!.medicationId, {
        ...(adjustForm.dosage.trim() ? { dosage: adjustForm.dosage.trim() } : {}),
        ...(adjustForm.frequency.trim() ? { frequency: adjustForm.frequency.trim() } : {}),
        ...(adjustForm.instructions.trim() ? { instructions: adjustForm.instructions.trim() } : {}),
      }),
    onSuccess: (pair) => {
      notify(`تم تعديل جرعة ${pair.newMedication.drugName} — الدواء السابق مؤرشف`)
      setAdjustMed(null)
      void queryClient.invalidateQueries({ queryKey: ["medications"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const stopMutation = useMutation({
    mutationFn: () =>
      ehrApi.discontinueMedication(
        stopMed!.medicationId,
        stopReason,
        stopReason === "OTHER" ? stopNote.trim() : undefined,
      ),
    onSuccess: (med) => {
      notify(`تم إيقاف ${med.drugName}`)
      setStopMed(null)
      setStopNote("")
      void queryClient.invalidateQueries({ queryKey: ["medications"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const medications = medsQuery.data?.medications ?? []
  const active = medications.filter((m) => m.status === "ACTIVE")
  const stopped = medications.filter((m) => m.status === "DISCONTINUED")
  const lastUpdate = [...medications]
    .map((m) => m.startedAt)
    .sort()
    .pop()

  const patientName = patientQuery.data?.fullName ?? current?.displayName ?? "—"

  if (!resolvedPatientId) {
    /* Bento layout — never let one small card float in a sea of navy:
       the main selector sits beside today's live queue and a tips card. */
    const waitingPatients = entries.filter((e) => e.status === "WAITING")
    const inRoom = entries.find((e) => e.status === "IN_CONSULTATION")
    return (
      <motion.div
        className="med-bento"
        variants={listStagger}
        initial="hidden"
        animate="visible"
      >
        <motion.section className="card med-patient bento-main" variants={rise}>
          <div className="patient-heading compact">
            <span className="patient-avatar large">؟</span>
            <div>
              <span className="id-label">الخطة الدوائية</span>
              <h3>اختر مريضًا لعرض أدويته</h3>
              <p>افتح ملف مريض أو استخدم جلسة جارية لعرض الخطة الدوائية وتعديلها.</p>
            </div>
          </div>
          <AppButton icon="users" onClick={() => navigate("/doctor/patients")}>
            بحث في ملفات المرضى
          </AppButton>
          {inRoom && (
            <button
              type="button"
              className="bento-inline-link"
              onClick={() => navigate(`/doctor/medications/${inRoom.patientId}`)}
            >
              <Icon name="activity" size={15} />
              الجلسة الجارية: {inRoom.displayName} — افتح خطته الآن
            </button>
          )}
        </motion.section>

        <motion.aside className="side-stack bento-side" variants={rise}>
          <motion.section className="card" variants={rise}>
            <div className="card-header">
              <div>
                <span className="section-kicker">مباشر الآن</span>
                <h3>طابور اليوم</h3>
                <p>
                  {waitingPatients.length > 0
                    ? `${arNum(waitingPatients.length)} مريضًا في الانتظار`
                    : "لا انتظار حاليًا"}
                </p>
              </div>
            </div>
            {waitingPatients.length === 0 && (
              <p className="bento-muted">
                عند تسجيل الحضور سيظهر المرضى هنا، وتفتح الخطة الدوائية لأي منهم بضغطة واحدة.
              </p>
            )}
            <div className="bento-queue">
              {waitingPatients.slice(0, 5).map((e, i) => (
                <button
                  type="button"
                  key={e.entryId}
                  onClick={() => navigate(`/doctor/medications/${e.patientId}`)}
                >
                  <span className="queue-number">{arNum(i + 1)}</span>
                  <span className="bento-queue-name">{e.displayName}</span>
                  <span className="text-link">الخطة</span>
                </button>
              ))}
            </div>
          </motion.section>

          <motion.section className="card" variants={rise}>
            <div className="card-header">
              <div>
                <span className="section-kicker">مساعدة سريعة</span>
                <h3>نصائح الخطة الدوائية</h3>
              </div>
            </div>
            <ul className="bento-tips">
              <li>
                <Icon name="plus" size={15} />
                أضف الدواء بالاسم العلمي أو التجاري مع الجرعة والتكرار بوضوح.
              </li>
              <li>
                <Icon name="edit" size={15} />
                تعديل الجرعة يؤرشف السجل القديم — يبقى تتبع التعديلات كاملًا.
              </li>
              <li>
                <Icon name="alert" size={15} />
                لا يوجد فحص تعارضات آلي — راجع التعارضات بنفسك قبل أي إضافة.
              </li>
            </ul>
          </motion.section>
        </motion.aside>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="med-layout"
      variants={listStagger}
      initial="hidden"
      animate="visible"
    >
      <section className="med-main">
        <motion.div className="card med-patient" variants={rise}>
          <div className="patient-heading compact">
            <span className="patient-avatar large">{patientName.charAt(0)}</span>
            <div>
              <span className="id-label">الخطة الدوائية</span>
              <h3>{patientName}</h3>
              <p>
                {resolvedPatientId.slice(-6)} ·{" "}
                {lastUpdate ? `آخر تحديث ${arAgo(lastUpdate)}` : "لا أدوية مسجلة"}
              </p>
            </div>
          </div>
          <AppButton icon="plus" onClick={() => setShowAdd(true)}>
            إضافة دواء
          </AppButton>
        </motion.div>

        <motion.section className="card medication-list" variants={rise}>
          <div className="card-header">
            <div>
              <span className="section-kicker">نشط الآن</span>
              <h2>الأدوية الحالية</h2>
            </div>
            <span className="count-pill">{arNum(active.length)} دواء</span>
          </div>
          {medsQuery.isLoading && <SkeletonBlock lines={2} />}
          {!medsQuery.isLoading && active.length === 0 && (
            <p style={{ padding: "8px 2px" }}>لا أدوية نشطة — أضف أول دواء للخطة.</p>
          )}
          {active.map((med) => (
            <MedicationCard
              key={med.medicationId}
              med={med}
              busy={adjustMutation.isPending || stopMutation.isPending}
              onAdjust={() => {
                setAdjustMed(med)
                setAdjustForm({
                  dosage: med.dosage,
                  frequency: med.frequency,
                  instructions: med.instructions,
                })
              }}
              onDiscontinue={() => setStopMed(med)}
            />
          ))}
        </motion.section>

        <motion.section className="card medication-list discontinued" variants={rise}>
          <div className="card-header">
            <div>
              <span className="section-kicker">السجل السابق</span>
              <h2>أدوية متوقفة</h2>
            </div>
            <span className="count-pill">{arNum(stopped.length)} دواء</span>
          </div>
          {stopped.length === 0 && (
            <p style={{ padding: "8px 2px" }}>لا أدوية متوقفة.</p>
          )}
          {stopped.map((med) => (
            <div className="med-card stopped" key={med.medicationId}>
              <div className="med-icon">
                <Icon name="pill" />
              </div>
              <div>
                <div className="med-name">
                  <h3>{med.drugName}</h3>
                  <span>متوقف</span>
                </div>
                <p>
                  {med.dosage} · {med.frequency}
                </p>
                <small>
                  من {arDate(med.startedAt)} إلى {med.stoppedAt ? arDate(med.stoppedAt) : "—"}
                </small>
                <div className="stop-reason">
                  <strong>سبب الإيقاف:</strong>{" "}
                  {cessationReasonOptions.find((o) => o.value === med.cessationReasonCode)?.label ??
                    med.cessationReasonCode ??
                    "غير موثق"}
                  {med.cessationNote ? ` — ${med.cessationNote}` : ""}
                </div>
              </div>
            </div>
          ))}
        </motion.section>
      </section>

      <motion.aside className="side-stack" variants={listStagger}>
        <motion.section className="card safety-card" variants={rise}>
          <div className="safety-icon">
            <Icon name="heart" />
          </div>
          <h3>مراجعة السلامة الدوائية</h3>
          <p>
            لا يوفر النظام حاليًا فحصًا آليًا للتعارضات الدوائية — راجع التعارضات
            من مصدر دوائي معتمد قبل أي إضافة، فالقرار السريري مسؤوليتك.
          </p>
          <div className="safety-status">
            <Icon name="alert" />
            <span>
              <strong>لا يوجد فحص تعارضات آلي</strong>
              <small>حد الخدمة الحالي في النظام</small>
            </span>
          </div>
        </motion.section>
        <motion.section className="card med-history" variants={rise}>
          <h3>ملخص السجل</h3>
          <span>
            <small>أدوية حالية</small>
            <b>{arNum(active.length)}</b>
          </span>
          <span>
            <small>أدوية متوقفة</small>
            <b>{arNum(stopped.length)}</b>
          </span>
          <span>
            <small>آخر تحديث</small>
            <b>{lastUpdate ? arDate(lastUpdate) : "—"}</b>
          </span>
        </motion.section>
      </motion.aside>

      {showAdd && (
        <Modal
          title="إضافة دواء جديد"
          subtitle="يُسجل الدواء في خطة المريض باسمك."
          onClose={() => setShowAdd(false)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (addForm.drugName.trim() && addForm.dosage.trim() && addForm.frequency.trim()) {
                addMutation.mutate()
              }
            }}
          >
            <label className="field">
              <span>
                اسم الدواء <b>*</b>
              </span>
              <input
                value={addForm.drugName}
                onChange={(e) => setAddForm({ ...addForm, drugName: e.target.value })}
                placeholder="الاسم العلمي أو التجاري"
              />
            </label>
            <div className="form-row">
              <label className="field">
                <span>
                  الجرعة <b>*</b>
                </span>
                <input
                  value={addForm.dosage}
                  onChange={(e) => setAddForm({ ...addForm, dosage: e.target.value })}
                  placeholder="مثال: ١٠ مجم"
                />
              </label>
              <label className="field">
                <span>
                  التكرار <b>*</b>
                </span>
                <input
                  value={addForm.frequency}
                  onChange={(e) => setAddForm({ ...addForm, frequency: e.target.value })}
                  placeholder="مثال: مرتين يوميًا"
                />
              </label>
            </div>
            <label className="field">
              <span>تعليمات</span>
              <input
                value={addForm.instructions}
                onChange={(e) => setAddForm({ ...addForm, instructions: e.target.value })}
                placeholder="مثال: بعد الأكل مع كوب ماء"
              />
            </label>
            <div className="review-warning">
              <strong>تذكير قبل الإضافة</strong>
              <p>
                راجع التعارضات الدوائية بنفسك — لا يجري النظام فحصًا آليًا
                للتعارضات.
              </p>
            </div>
            <div className="modal-actions">
              <AppButton variant="outline" type="button" onClick={() => setShowAdd(false)}>
                إلغاء
              </AppButton>
              <AppButton
                type="submit"
                icon="plus"
                disabled={
                  addMutation.isPending ||
                  !addForm.drugName.trim() ||
                  !addForm.dosage.trim() ||
                  !addForm.frequency.trim()
                }
              >
                {addMutation.isPending ? "جارٍ الإضافة..." : "إضافة الدواء"}
              </AppButton>
            </div>
          </form>
        </Modal>
      )}

      {adjustMed && (
        <Modal
          title={`تعديل جرعة ${adjustMed.drugName}`}
          subtitle="يُؤرشف الدواء الحالي ويُنشأ سجل جرعة جديد (تتبع كامل للتعديلات)."
          onClose={() => setAdjustMed(null)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              adjustMutation.mutate()
            }}
          >
            <div className="form-row">
              <label className="field">
                <span>الجرعة الجديدة</span>
                <input
                  value={adjustForm.dosage}
                  onChange={(e) => setAdjustForm({ ...adjustForm, dosage: e.target.value })}
                />
              </label>
              <label className="field">
                <span>التكرار الجديد</span>
                <input
                  value={adjustForm.frequency}
                  onChange={(e) => setAdjustForm({ ...adjustForm, frequency: e.target.value })}
                />
              </label>
            </div>
            <label className="field">
              <span>تعليمات</span>
              <input
                value={adjustForm.instructions}
                onChange={(e) => setAdjustForm({ ...adjustForm, instructions: e.target.value })}
              />
            </label>
            <div className="modal-actions">
              <AppButton variant="outline" type="button" onClick={() => setAdjustMed(null)}>
                إلغاء
              </AppButton>
              <AppButton type="submit" icon="check" disabled={adjustMutation.isPending}>
                {adjustMutation.isPending ? "جارٍ التعديل..." : "اعتماد التعديل"}
              </AppButton>
            </div>
          </form>
        </Modal>
      )}

      {stopMed && (
        <Modal
          title={`إيقاف ${stopMed.drugName}`}
          subtitle="يوثق سبب الإيقاف في السجل الدوائي."
          onClose={() => setStopMed(null)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (stopReason !== "OTHER" || stopNote.trim()) stopMutation.mutate()
            }}
          >
            <label className="field">
              <span>سبب الإيقاف</span>
              <select value={stopReason} onChange={(e) => setStopReason(e.target.value)}>
                {cessationReasonOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {stopReason === "OTHER" && (
              <label className="field">
                <span>
                  تفصيل السبب <b>*</b>
                </span>
                <input
                  value={stopNote}
                  onChange={(e) => setStopNote(e.target.value)}
                  placeholder="اكتب السبب السريري"
                />
              </label>
            )}
            <div className="modal-actions">
              <AppButton variant="outline" type="button" onClick={() => setStopMed(null)}>
                إلغاء
              </AppButton>
              <AppButton
                type="submit"
                variant="danger"
                disabled={stopMutation.isPending || (stopReason === "OTHER" && !stopNote.trim())}
              >
                {stopMutation.isPending ? "جارٍ الإيقاف..." : "إيقاف الدواء"}
              </AppButton>
            </div>
          </form>
        </Modal>
      )}
    </motion.div>
  )
}
