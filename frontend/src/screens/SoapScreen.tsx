/**
 * SOAP reports screen — design preserved (soap-header + soap-document +
 * review checklist). Real data:
 *  - Picker state: drafts awaiting review (supervision/unsigned-notes) and a
 *    patient search to open any chart.
 *  - Viewer: encounter from GET /ehr/encounters/:id — edit DRAFTs via PATCH
 *    (If-Match rowVersion), sign via POST /sign; SIGNED reports render
 *    read-only with addenda support.
 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ehrApi } from "@/api/ehr"
import { patientsApi } from "@/api/patients"
import { supervisionApi } from "@/api/admin"
import { apiErrorMessage } from "@/api/client"
import { AppButton, Icon, Modal, useToast, SkeletonBlock } from "@/components/ui"
import { arDate, arNum, arAgo } from "@/lib/format"
import { addendumReasonOptions } from "@/lib/constants"

const sectionTitles: Record<string, string> = {
  S: "Subjective — الشكوى والتجربة الذاتية",
  O: "Objective — الملاحظات الموضوعية",
  A: "Assessment — التقييم",
  P: "Plan — الخطة",
}

export default function SoapScreen() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const encounterParam = params.get("encounter")

  const [editing, setEditing] = useState(false)
  const [draftSoap, setDraftSoap] = useState<{
    S: string
    O: string
    A: string
    P: string
  } | null>(null)
  const [reviewChecks, setReviewChecks] = useState({ S: true, O: true, A: true, P: false })
  const [showAddendum, setShowAddendum] = useState(false)
  const [addendumText, setAddendumText] = useState("")
  const [addendumReason, setAddendumReason] = useState("CLARIFICATION")
  const [search, setSearch] = useState("")

  const encounterQuery = useQuery({
    queryKey: ["encounter", encounterParam],
    queryFn: () => ehrApi.getEncounter(encounterParam!),
    enabled: Boolean(encounterParam),
  })

  const unsignedQuery = useQuery({
    queryKey: ["supervision", "unsigned-notes"],
    queryFn: () => supervisionApi.unsignedNotes(),
    enabled: !encounterParam,
  })

  const encounter = encounterQuery.data
  const patientQuery = useQuery({
    queryKey: ["patient", encounter?.patientId],
    queryFn: () => patientsApi.get(encounter!.patientId),
    enabled: Boolean(encounter),
  })

  const draftEncounters = unsignedQuery.data?.staleDrafts.filter(
    (d) => d.draftKind === "ENCOUNTER",
  ) ?? []
  const scribeDrafts = unsignedQuery.data?.staleDrafts.filter(
    (d) => d.draftKind === "SCRIBE",
  ) ?? []
  const withoutSigned = unsignedQuery.data?.completedWithoutSigned.filter(
    (c) => !c.hasSignedEncounter,
  ) ?? []

  const isDraft = encounter?.status === "DRAFT"
  const isSigned = encounter?.status === "SIGNED"

  const saveMutation = useMutation({
    mutationFn: () =>
      ehrApi.patchEncounter(encounter!.encounterId, encounter!.rowVersion, {
        soap: draftSoap ?? undefined,
      }),
    onSuccess: (res) => {
      notify("تم حفظ المسودة")
      setEditing(false)
      setDraftSoap(null)
      void queryClient.invalidateQueries({ queryKey: ["encounter"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const signMutation = useMutation({
    mutationFn: () => ehrApi.sign(encounter!.encounterId, encounter!.rowVersion),
    onSuccess: () => {
      notify("تم اعتماد التقرير وإضافته للسجل الطبي")
      void queryClient.invalidateQueries({ queryKey: ["encounter"] })
      void queryClient.invalidateQueries({ queryKey: ["supervision"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const addendumMutation = useMutation({
    mutationFn: () =>
      ehrApi.addAddendum(encounter!.encounterId, addendumText.trim(), addendumReason),
    onSuccess: () => {
      notify("أُضيف الملحق إلى التقرير")
      setShowAddendum(false)
      setAddendumText("")
      void queryClient.invalidateQueries({ queryKey: ["encounter"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const openEncounter = (id: string) => {
    setParams({ encounter: id })
    setEditing(false)
    setDraftSoap(null)
    setReviewChecks({ S: true, O: true, A: true, P: false })
  }

  const soapForDisplay =
    draftSoap ?? {
        S: encounter?.soap?.S ?? "",
        O: encounter?.soap?.O ?? "",
        A: encounter?.soap?.A ?? "",
        P: encounter?.soap?.P ?? "",
      }
  const reviewDone = Object.values(reviewChecks).filter(Boolean).length

  /* ---------------------------- Picker view ---------------------------- */

  if (!encounterParam) {
    return (
      <section className="card archive-card">
        <div className="card-header">
          <div>
            <span className="section-kicker">التوثيق السريري</span>
            <h2>تقارير SOAP</h2>
            <p>راجع المسودات المعلقة وافتح تقارير المرضى.</p>
          </div>
        </div>
        <label className="large-search">
          <Icon name="search" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث عن مريض لفتح أحدث تقاريره (٣ أحرف على الأقل)..."
          />
        </label>
        <div className="data-table" style={{ marginTop: "12px" }}>
          <div className="data-head">
            <span>النوع</span>
            <span>المريض / المعرف</span>
            <span>العمر</span>
            <span>الحالة</span>
            <span />
          </div>
          {unsignedQuery.isLoading && <SkeletonBlock lines={3} />}
          {draftEncounters.map((d) => (
            <button className="data-row" key={d.draftId} onClick={() => openEncounter(d.draftId)}>
              <strong>مسودة تقرير</strong>
              <span>{d.patientId.slice(-6)}</span>
              <span>{arAgo(d.createdAt)}</span>
              <span className="method-pill">مسودة</span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
          {withoutSigned.map((c) => (
            <div className="data-row" key={c.queueEntryId} style={{ cursor: "default" }}>
              <strong>زيارة غير موثقة</strong>
              <span>{c.displayName}</span>
              <span>{arAgo(c.completedAt)}</span>
              <span className="method-pill">بانتظار التوثيق</span>
              <Icon name="alert" size={16} />
            </div>
          ))}
          {scribeDrafts.length > 0 && (
            <div className="data-row" style={{ cursor: "default" }}>
              <strong>جلسات AI</strong>
              <span>{arNum(scribeDrafts.length)} جلسة مسجلة غير مكتملة</span>
              <span>—</span>
              <span className="method-pill">قيد المعالجة</span>
              <Icon name="sparkle" size={16} />
            </div>
          )}
          {!unsignedQuery.isLoading &&
            draftEncounters.length === 0 &&
            withoutSigned.length === 0 &&
            scribeDrafts.length === 0 && (
              <div className="data-row">
                <span>لا مسودات معلقة — كل تقارير اليوم معتمدة.</span>
              </div>
            )}
        </div>
        <SearchResults query={search} onOpen={openEncounter} />
      </section>
    )
  }

  /* ---------------------------- Report view ---------------------------- */

  if (encounterQuery.isLoading) {
    return (
      <section className="card">
        <SkeletonBlock lines={5} />
      </section>
    )
  }

  if (encounterQuery.isError || !encounter) {
    return (
      <section className="card form-card">
        <div className="step-header">
          <span className="step-no">!</span>
          <div>
            <h2>تعذر فتح التقرير</h2>
            <p>{apiErrorMessage(encounterQuery.error)}</p>
          </div>
        </div>
        <AppButton variant="outline" onClick={() => setParams({})}>
          العودة إلى قائمة التقارير
        </AppButton>
      </section>
    )
  }

  const patientName = patientQuery.data?.fullName ?? encounter.patientId.slice(-6)

  return (
    <>
      <section className="soap-header">
        <div>
          <div className="draft-badge">
            <Icon name={encounter.source === "SCRIBE" ? "sparkle" : "file"} size={15} />{" "}
            {isDraft
              ? encounter.source === "SCRIBE"
                ? "مسودة مولّدة بمساعدة AI"
                : "مسودة يدوية بانتظار الاعتماد"
              : "تقرير معتمد"}
          </div>
          <h2>تقرير جلسة {patientName}</h2>
          <p>
            {arDate(encounter.visitDate ?? encounter.createdAt)} ·{" "}
            {encounter.encounterId.slice(-6)} ·{" "}
            {isSigned ? `معتمد ${arDate(encounter.signedAt)}` : "غير معتمد بعد"}
          </p>
        </div>
        <div className="soap-actions">
          {isDraft && (
            <>
              <AppButton
                variant="outline"
                onClick={() => {
                  if (editing) {
                    setEditing(false)
                    setDraftSoap(null)
                  } else {
                    setDraftSoap({
                      S: encounter.soap?.S ?? "",
                      O: encounter.soap?.O ?? "",
                      A: encounter.soap?.A ?? "",
                      P: encounter.soap?.P ?? "",
                    })
                    setEditing(true)
                  }
                }}
              >
                {editing ? "إلغاء التعديل" : "تعديل التقرير"}
              </AppButton>
              <AppButton
                variant="secondary"
                onClick={() => saveMutation.mutate()}
                disabled={!editing || saveMutation.isPending}
              >
                {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ كمسودة"}
              </AppButton>
              <AppButton
                icon="check"
                onClick={() => signMutation.mutate()}
                disabled={signMutation.isPending}
                title={
                  (["S", "O", "A", "P"] as const).some(
                    (k) => !encounter.soap?.[k]?.trim(),
                  )
                    ? "أكمل أقسام SOAP أولًا"
                    : ""
                }
              >
                {signMutation.isPending ? "جارٍ الاعتماد..." : "اعتماد التقرير"}
              </AppButton>
            </>
          )}
          {isSigned && (
            <AppButton variant="outline" icon="plus" onClick={() => setShowAddendum(true)}>
              إضافة ملحق
            </AppButton>
          )}
        </div>
      </section>

      <div className="soap-layout">
        <section className="soap-document">
          {isDraft && encounter.source === "SCRIBE" && (
            <div className="ai-disclaimer">
              <Icon name="sparkle" />
              <div>
                <strong>مسودة تحتاج مراجعتك السريرية</strong>
                <p>
                  تم تنظيم المحتوى من التسجيل. راجع الدقة وصحّح أي نقاط قبل
                  الاعتماد.
                </p>
              </div>
            </div>
          )}
          {(["S", "O", "A", "P"] as const).map((letter) => (
            <article className="soap-section" key={letter}>
              <div className="soap-letter">{letter}</div>
              <div>
                <h3>{sectionTitles[letter]}</h3>
                {editing && draftSoap ? (
                  <textarea
                    value={draftSoap[letter]}
                    onChange={(e) => setDraftSoap({ ...draftSoap, [letter]: e.target.value })}
                    rows={4}
                  />
                ) : (
                  <p>{soapForDisplay[letter] || "— غير مكتمل —"}</p>
                )}
                {isDraft && encounter.source === "SCRIBE" && (
                  <span className="ai-source">
                    <Icon name="sparkle" size={13} /> محتوى مقترح
                  </span>
                )}
              </div>
            </article>
          ))}

          <article className="soap-section">
            <div className="soap-letter">MSE</div>
            <div>
              <h3>تقييم الحالة الذهنية</h3>
              <p>
                المظهر: {encounter.mse.appearance} · السلوك: {encounter.mse.behavior} ·
                ترابط الكلام: {encounter.mse.speechCoherence} · المزاج:{" "}
                {encounter.mse.moodAffect}
              </p>
            </div>
          </article>

          {encounter.diagnoses.length > 0 && (
            <article className="soap-section">
              <div className="soap-letter">Dx</div>
              <div>
                <h3>التشخيصات المسجلة</h3>
                {encounter.diagnoses.map((d) => (
                  <p key={d}>• {d}</p>
                ))}
              </div>
            </article>
          )}

          {encounter.addenda.length > 0 && (
            <article className="soap-section">
              <div className="soap-letter">+</div>
              <div>
                <h3>الملاحق بعد الاعتماد</h3>
                {encounter.addenda.map((a) => (
                  <p key={a.id}>
                    • ({a.reasonCode}) {a.text} — {arDate(a.createdAt)}
                  </p>
                ))}
              </div>
            </article>
          )}
        </section>

        <aside className="side-stack soap-side">
          <section className="card review-checklist">
            <h3>قائمة المراجعة</h3>
            {(["S", "O", "A", "P"] as const).map((k) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={reviewChecks[k]}
                  disabled={!isDraft}
                  onChange={(e) => setReviewChecks({ ...reviewChecks, [k]: e.target.checked })}
                />{" "}
                قسم {k} — {sectionTitles[k].split("—")[0].trim()}
              </label>
            ))}
            <div className="review-progress">
              <div>
                <i style={{ width: `${(reviewDone / 4) * 100}%` }} />
              </div>
              <span>
                {arNum(reviewDone)} من {arNum(4)} مكتملة
              </span>
            </div>
          </section>
          <button className="back-profile" onClick={() => navigate(`/doctor/patients/${encounter.patientId}`)}>
            <Icon name="arrow" /> العودة إلى الملف الطبي
          </button>
        </aside>
      </div>

      {showAddendum && (
        <Modal
          title="إضافة ملحق للتقرير المعتمد"
          subtitle="الملاحق تُسجل بعد الاعتماد ولا تعدل النص الأصلي."
          onClose={() => setShowAddendum(false)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (addendumText.trim()) addendumMutation.mutate()
            }}
          >
            <label className="field">
              <span>نص الملحق</span>
              <textarea
                value={addendumText}
                onChange={(e) => setAddendumText(e.target.value)}
                placeholder="توضيح أو معلومة جديدة بعد الاعتماد..."
                rows={3}
              />
            </label>
            <label className="field">
              <span>سبب الملحق</span>
              <select
                value={addendumReason}
                onChange={(e) => setAddendumReason(e.target.value)}
              >
                {addendumReasonOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <AppButton variant="outline" type="button" onClick={() => setShowAddendum(false)}>
                إلغاء
              </AppButton>
              <AppButton
                type="submit"
                icon="plus"
                disabled={addendumMutation.isPending || !addendumText.trim()}
              >
                {addendumMutation.isPending ? "جارٍ الإضافة..." : "إضافة الملحق"}
              </AppButton>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

function SearchResults({
  query,
  onOpen,
}: {
  query: string
  onOpen: (encounterId: string) => void
}) {
  const trimmed = query.trim()
  const [debounced, setDebounced] = useState(trimmed)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), 350)
    return () => clearTimeout(timer)
  }, [trimmed])

  const searchQuery = useQuery({
    queryKey: ["patient-search", debounced],
    queryFn: () => patientsApi.search(debounced),
    enabled: debounced.length >= 3,
  })

  const chartQuery = useQuery({
    queryKey: ["chart", searchQuery.data?.data[0]?.id ?? "none", "soap-picker"],
    queryFn: () => ehrApi.chart(searchQuery.data!.data[0].id, 10),
    enabled: (searchQuery.data?.data.length ?? 0) > 0,
  })

  if (debounced.length < 3) return null
  const encounters = chartQuery.data?.encounters ?? []

  return (
    <div className="data-table" style={{ marginTop: "14px" }}>
      <div className="data-head">
        <span>المريض</span>
        <span>التقرير</span>
        <span>التاريخ</span>
        <span />
      </div>
      {encounters.length === 0 && (
        <div className="data-row">
          <span>
            {searchQuery.isFetching || chartQuery.isFetching
              ? "جارٍ البحث…"
              : "لا تقارير مطابقة."}
          </span>
        </div>
      )}
      {encounters.map((enc) => (
        <button className="data-row" key={enc.encounterId} onClick={() => onOpen(enc.encounterId)}>
          <strong>{searchQuery.data?.data[0]?.fullName ?? "—"}</strong>
          <span>{enc.encounterId.slice(-6)}</span>
          <span>{arDate(enc.signedAt ?? enc.visitDate)}</span>
          <Icon name="chevron" size={16} />
        </button>
      ))}
    </div>
  )
}
