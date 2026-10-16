/**
 * Check-in screen — design preserved; real search (GET /patients/search,
 * 3+ chars, debounced), real duplicate detection (409 POSSIBLE_DUPLICATE →
 * confirmNotDuplicate), real registration (POST /patients) and check-in
 * (POST /queue/check-in with Idempotency-Key).
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { patientsApi, type CreatePatientInput } from "@/api/patients"
import { queueApi } from "@/api/queue"
import { settingsApi } from "@/api/admin"
import { apiErrorMessage, ApiError } from "@/api/client"
import { AppButton, Icon, Modal, useToast } from "@/components/ui"
import { arAgo, arNum, arTime, ageFromDob, moneyMinor, formatPhone } from "@/lib/format"
import type { PatientDto, PatientSearchCandidateDto } from "@/api/types"

function NewPatientModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (patient: PatientDto) => void
}) {
  const { notify } = useToast()
  const [form, setForm] = useState({
    fullName: "",
    dateOfBirth: "",
    phone: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "",
    physicalAddress: "",
  })
  const [submitted, setSubmitted] = useState(false)
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: (confirm: boolean) =>
      patientsApi.create({ ...form, confirmNotDuplicate: confirm }),
    onSuccess: (patient) => {
      notify(`تم إنشاء ملف ${patient.fullName}`)
      onCreated(patient)
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === "POSSIBLE_DUPLICATE") {
        const candidate = err.details[0]?.expected?.split(":")[1] ?? ""
        setDuplicateWarning(candidate)
      } else {
        notify(apiErrorMessage(err), "error")
      }
    },
  })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (form.fullName.trim().length <= 4) return
    if (!form.dateOfBirth) return
    const hasAnchor =
      form.phone.trim() || form.emergencyContactPhone.trim()
    if (!hasAnchor) return
    if (!form.emergencyContactName.trim() || !form.physicalAddress.trim()) return
    createMutation.mutate(false)
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const hasAnchor = Boolean(form.phone.trim() || form.emergencyContactPhone.trim())
  const completeRequired = Boolean(
    form.emergencyContactName.trim() && form.physicalAddress.trim(),
  )

  return (
    <Modal
      title="تسجيل مريض جديد"
      subtitle="أدخل البيانات الأساسية لإنشاء الملف والمتابعة للحضور."
      onClose={onClose}
    >
      <form className="modal-form" onSubmit={submit}>
        <label className="field">
          <span>
            الاسم بالكامل <b>*</b>
          </span>
          <input value={form.fullName} onChange={set("fullName")} placeholder="الاسم الرباعي" />
          {submitted && form.fullName.trim().length <= 4 && (
            <small className="field-error">يرجى إدخال اسم المريض بالكامل.</small>
          )}
        </label>
        <div className="form-row">
          <label className="field">
            <span>
              تاريخ الميلاد <b>*</b>
            </span>
            <input type="date" value={form.dateOfBirth} onChange={set("dateOfBirth")} />
            {submitted && !form.dateOfBirth && (
              <small className="field-error">تاريخ الميلاد مطلوب.</small>
            )}
          </label>
          <label className="field">
            <span>الهاتف الأساسي</span>
            <input value={form.phone} onChange={set("phone")} placeholder="٠١٠ ٠٠٠٠ ٠٠٠٠" dir="ltr" />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>
              اسم جهة اتصال الطوارئ <b>*</b>
            </span>
            <input
              value={form.emergencyContactName}
              onChange={set("emergencyContactName")}
              placeholder="مثال: الأب / الأم / الزوج"
            />
          </label>
          <label className="field">
            <span>
              هاتف الطوارئ <b>*</b>
            </span>
            <input
              value={form.emergencyContactPhone}
              onChange={set("emergencyContactPhone")}
              placeholder="٠١٠ ٠٠٠٠ ٠٠٠٠"
              dir="ltr"
            />
          </label>
        </div>
        <div className="form-row">
          <label className="field">
            <span>صلة جهة الاتصال</span>
            <input
              value={form.emergencyContactRelation}
              onChange={set("emergencyContactRelation")}
              placeholder="والد / زميل ..."
            />
          </label>
          <label className="field">
            <span>
              العنوان <b>*</b>
            </span>
            <input
              value={form.physicalAddress}
              onChange={set("physicalAddress")}
              placeholder="المنطقة، المدينة، المحافظة"
            />
          </label>
        </div>
        {submitted && (!hasAnchor || !completeRequired) && (
          <small className="field-error">
            يلزم رقم هاتف واحد على الأقل، واسم وعنوان لجهة الطوارئ لإكمال التسجيل.
          </small>
        )}
        {duplicateWarning && (
          <div className="balance-warning">
            <Icon name="alert" size={18} />
            <span>
              <strong>يوجد ملف مشابه</strong>
              <small>راجع بيانات المريض — إن كان ملفًا مختلفًا أكمل التأكيد.</small>
            </span>
            <button type="button" onClick={() => createMutation.mutate(true)}>
              تأكيد الإضافة
            </button>
          </div>
        )}
        <div className="privacy-note">
          <Icon name="lock" size={18} />
          <span>
            <strong>بيانات محمية</strong>
            <small>لن تظهر الملاحظات الطبية في مساحة الاستقبال.</small>
          </span>
        </div>
        <div className="modal-actions">
          <AppButton variant="outline" onClick={onClose}>
            إلغاء
          </AppButton>
          <AppButton type="submit" icon="userPlus" disabled={createMutation.isPending}>
            {createMutation.isPending ? "جارٍ الإنشاء..." : "إنشاء الملف وتسجيل الحضور"}
          </AppButton>
        </div>
      </form>
    </Modal>
  )
}

export default function CheckInScreen() {
  const navigate = useNavigate()
  const { notify } = useToast()
  const [params, setParams] = useSearchParams()
  const queryClient = useQueryClient()

  const [query, setQuery] = useState(params.get("q") ?? "")
  const [debounced, setDebounced] = useState(query)
  const [selected, setSelected] = useState<PatientSearchCandidateDto | null>(null)
  const [checkedIn, setCheckedIn] = useState<{ name: string; position: number; wait: number } | null>(null)
  const [showRegistration, setShowRegistration] = useState(params.get("new") === "1")
  const [emergencyMode, setEmergencyMode] = useState(false)
  const [emergencyReason, setEmergencyReason] = useState("VISIBLE_DISTRESS")

  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const searchQuery = useQuery({
    queryKey: ["patient-search", debounced],
    queryFn: () => patientsApi.search(debounced),
    enabled: debounced.length >= 3,
  })

  const balanceQuery = useQuery({
    queryKey: ["patient-balance", selected?.id],
    queryFn: () => patientsApi.balance(selected!.id),
    enabled: Boolean(selected),
  })

  const checkInMutation = useMutation({
    mutationFn: (patientId: string) =>
      queueApi.checkIn(patientId, {
        isEmergency: emergencyMode,
        emergencyReasonCode: emergencyMode ? emergencyReason : undefined,
      }),
    onSuccess: (entry) => {
      setCheckedIn({
        name: entry.displayName,
        position: entry.position,
        wait: entry.estimatedWaitMin,
      })
      setSelected(null)
      notify("تم تسجيل الحضور بنجاح")
      void queryClient.invalidateQueries({ queryKey: ["queue"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const candidates = searchQuery.data?.data ?? []
  const results: PatientSearchCandidateDto[] = useMemo(() => candidates, [candidates])

  const onContinueRegistration = (patient: PatientDto) => {
    setShowRegistration(false)
    checkInMutation.mutate(patient.id)
  }

  return (
    <div className="two-col-layout">
      <section className="card form-card">
        <div className="step-header">
          <span className="step-no">١</span>
          <div>
            <h2>ابحث عن مريض مسجل</h2>
            <p>يمكنك البحث بالاسم أو رقم الهاتف (٣ أحرف على الأقل).</p>
          </div>
        </div>
        <label className="large-search">
          <Icon name="search" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCheckedIn(null)
              setSelected(null)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && results.length > 0 && !selected) {
                setSelected(results[0])
              }
            }}
            placeholder="مثال: هالة شريف أو ٠١٠..."
            autoFocus
          />
        </label>
        {query.length > 0 && query.length < 3 && (
          <p className="field-error">اكتب ٣ أحرف على الأقل للبحث.</p>
        )}

        {searchQuery.isFetching && query.length >= 3 && (
          <p className="field-error">جارٍ البحث…</p>
        )}

        {!selected && !checkedIn && query.length >= 3 && !searchQuery.isFetching && (
          <>
            {results.length === 0 && (
              <div className="search-hint">
                <Icon name="users" size={34} />
                <h3>لا نتائج مطابقة</h3>
                <p>لم نجد مريضًا بهذه البيانات — أنشئ ملفًا جديدًا من الخطوة المجاورة.</p>
              </div>
            )}
            {results.map((candidate) => (
              <button
                key={candidate.id}
                className="patient-match selectable"
                onClick={() => setSelected(candidate)}
              >
                <div className="match-top">
                  <span className="patient-avatar large">
                    {candidate.fullName.charAt(0)}
                  </span>
                  <div>
                    <h3>{candidate.fullName}</h3>
                    <p>
                      {candidate.id.slice(-6)} ·{" "}
                      {ageFromDob(candidate.dateOfBirth) !== null
                        ? `${arNum(ageFromDob(candidate.dateOfBirth) as number)} سنة`
                        : "العمر غير مسجل"}
                      {candidate.phone || candidate.phoneLast4 ? (
                        <> · <span className="phone-display">{formatPhone(candidate.phone, candidate.phoneLast4, "SECRETARY")}</span></>
                      ) : null}
                    </p>
                  </div>
                  <span className="match-label">
                    {candidate.hasDebtAlert ? (
                      <>
                        <Icon name="alert" size={14} /> رصيد مستحق
                      </>
                    ) : (
                      <>
                        <Icon name="check" size={14} /> مطابق
                      </>
                    )}
                  </span>
                </div>
              </button>
            ))}
          </>
        )}

        {selected && !checkedIn && (
          <div className="patient-match">
            <div className="match-top">
              <span className="patient-avatar large">
                {selected.fullName.charAt(0)}
              </span>
              <div>
                <h3>{selected.fullName}</h3>
                <p>
                  {selected.id.slice(-6)} ·{" "}
                  {ageFromDob(selected.dateOfBirth) !== null
                    ? `${arNum(ageFromDob(selected.dateOfBirth) as number)} سنة`
                    : "—"}
                </p>
              </div>
              <span className="match-label">
                <Icon name="check" size={14} /> تطابق مؤكد
              </span>
            </div>
            <div className="patient-meta">
              <span>
                <small>رقم الهاتف</small>
                <b className="phone-display">{formatPhone(selected.phone, selected.phoneLast4, "SECRETARY")}</b>
              </span>
              <span>
                <small>آخر زيارة</small>
                <b>{selected.lastVisitAt ? arAgo(selected.lastVisitAt) : "أول زيارة"}</b>
              </span>
              <span>
                <small>حالة الملف</small>
                <b>{selected.registrationStatus === "COMPLETE" ? "مكتمل" : "غير مكتمل"}</b>
              </span>
            </div>
            {balanceQuery.data && balanceQuery.data.outstandingMinor > 0 && (
              <div className="balance-warning">
                <Icon name="alert" size={18} />
                <span>
                  <strong>رصيد سابق مستحق</strong>
                  <small>
                    يوجد مبلغ {moneyMinor(balanceQuery.data.outstandingMinor)} من زيارات سابقة
                    ({arNum(balanceQuery.data.lines.length)} فاتورة).
                  </small>
                </span>
                <button onClick={() => navigate(`/secretary/payments?patient=${selected.id}`)}>
                  عرض الرصيد
                </button>
              </div>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={emergencyMode}
                onChange={(e) => setEmergencyMode(e.target.checked)}
              />
              <span>حالة طارئة — أولوية فورية</span>
            </label>
            {emergencyMode && (
              <label className="field">
                <span>سبب الطوارئ</span>
                <select
                  value={emergencyReason}
                  onChange={(e) => setEmergencyReason(e.target.value)}
                >
                  <option value="VISIBLE_DISTRESS">اضطراب ظاهر</option>
                  <option value="DOCTOR_DIRECTED">توجيه من الطبيب</option>
                  <option value="FAMILY_ESCALATION">تصعيد من الأسرة</option>
                  <option value="PRE_ARRANGED_URGENT">حالة عاجلة متفق عليها</option>
                  <option value="OTHER_URGENT">سبب عاجل آخر</option>
                </select>
              </label>
            )}
            <AppButton
              icon="check"
              onClick={() => checkInMutation.mutate(selected.id)}
              disabled={checkInMutation.isPending}
            >
              {checkInMutation.isPending ? "جارٍ التسجيل..." : "تأكيد تسجيل الحضور"}
            </AppButton>
          </div>
        )}

        {checkedIn && (
          <div className="success-state">
            <span className="success-icon">
              <Icon name="check" size={28} />
            </span>
            <h3>تم تسجيل حضور {checkedIn.name}</h3>
            <p>أُضيفت إلى الطابور — الحالة الآن في الانتظار.</p>
            <div className="success-details">
              <span>
                <small>ترتيب الطابور</small>
                <strong>{arNum(checkedIn.position)}</strong>
              </span>
              <span>
                <small>الانتظار المتوقع</small>
                <strong>نحو {arNum(checkedIn.wait)} دقيقة</strong>
              </span>
            </div>
            <AppButton onClick={() => navigate("/secretary")}>
              عرض قائمة الانتظار
            </AppButton>
          </div>
        )}

        {!query && (
          <div className="search-hint">
            <Icon name="users" size={34} />
            <h3>ابدأ بكتابة بيانات المريض</h3>
            <p>ستظهر النتائج المطابقة هنا مع آخر زيارة وأي رصيد مستحق.</p>
          </div>
        )}
      </section>
      <aside className="card registration-prompt">
        <div className="prompt-art">
          <span />
          <Icon name="userPlus" size={38} />
        </div>
        <span className="section-kicker">مريض لأول مرة؟</span>
        <h2>أنشئ ملفًا جديدًا بسرعة</h2>
        <p>
          سجّل البيانات الأساسية فقط، ثم أكمل تسجيل الحضور مباشرة دون مغادرة
          المسار.
        </p>
        <ul>
          <li>
            <Icon name="check" size={16} /> بيانات مختصرة وواضحة
          </li>
          <li>
            <Icon name="check" size={16} /> رقم ملف يُنشأ تلقائيًا
          </li>
          <li>
            <Icon name="check" size={16} /> إضافة فورية للطابور
          </li>
        </ul>
        <AppButton variant="secondary" icon="plus" onClick={() => setShowRegistration(true)}>
          تسجيل مريض جديد
        </AppButton>
      </aside>

      {showRegistration && (
        <NewPatientModal
          onClose={() => setShowRegistration(false)}
          onCreated={onContinueRegistration}
        />
      )}
    </div>
  )
}
