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
import { ehrApi, type AiDiagnosisResultDto } from "@/api/ehr"
import { patientsApi } from "@/api/patients"
import { supervisionApi } from "@/api/admin"
import { apiErrorMessage } from "@/api/client"
import { AppButton, Icon, Modal, useToast, SkeletonBlock } from "@/components/ui"
import { arDate, arNum, arAgo } from "@/lib/format"
import { useAuth } from "@/auth/AuthContext"
import { addendumReasonOptions } from "@/lib/constants"
import type { StructuredDiagnosisDto } from "@/api/types"

const normalizeDiagnoses = (raw: unknown[]): StructuredDiagnosisDto[] => {
  return raw.map((item) => {
    if (typeof item === "string") {
      return { name: item, type: "PRIMARY" }
    }
    if (item && typeof item === "object" && "name" in item) {
      return item as StructuredDiagnosisDto
    }
    return { name: String(item), type: "PRIMARY" }
  })
}

const diagnosisTypeLabel: Record<string, string> = {
  PRIMARY: "رئيسي",
  SECONDARY: "ثانوي",
  DIFFERENTIAL: "تفريقي",
}

const sectionTitles: Record<string, string> = {
  S: "Subjective — الشكوى والتجربة الذاتية",
  O: "Objective — الملاحظات الموضوعية",
  A: "Assessment — التقييم",
  P: "Plan — الخطة",
}

export default function SoapScreen() {
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"
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
  const [draftDiagnoses, setDraftDiagnoses] = useState<StructuredDiagnosisDto[] | null>(null)
  const [draftDiagnosisNotes, setDraftDiagnosisNotes] = useState<string | null>(null)

  // New diagnosis row form state
  const [newDxName, setNewDxName] = useState("")
  const [newDxCode, setNewDxCode] = useState("")
  const [newDxType, setNewDxType] = useState<"PRIMARY" | "SECONDARY" | "DIFFERENTIAL">("PRIMARY")
  const [newDxNotes, setNewDxNotes] = useState("")

  // AI Diagnosis modal state
  const [showAiModal, setShowAiModal] = useState(false)
  const [aiSuggestions, setAiSuggestions] = useState<AiDiagnosisResultDto | null>(null)
  const [selectedAiIndices, setSelectedAiIndices] = useState<number[]>([])

  const [reviewChecks, setReviewChecks] = useState({ S: false, O: false, A: false, P: false })
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
    enabled: Boolean(!encounterParam && isDoctor),
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

  const startEditing = () => {
    setDraftSoap({
      S: encounter?.soap?.S ?? "",
      O: encounter?.soap?.O ?? "",
      A: encounter?.soap?.A ?? "",
      P: encounter?.soap?.P ?? "",
    })
    setDraftDiagnoses(normalizeDiagnoses(encounter?.diagnoses ?? []))
    setDraftDiagnosisNotes(encounter?.diagnosisNotes ?? "")
    setEditing(true)
  }

  const cancelEditing = () => {
    setEditing(false)
    setDraftSoap(null)
    setDraftDiagnoses(null)
    setDraftDiagnosisNotes(null)
    setNewDxName("")
    setNewDxCode("")
    setNewDxType("PRIMARY")
    setNewDxNotes("")
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      ehrApi.patchEncounter(encounter!.encounterId, encounter!.rowVersion, {
        soap: draftSoap ?? undefined,
        diagnoses: draftDiagnoses ?? undefined,
        diagnosisNotes: draftDiagnosisNotes !== null ? draftDiagnosisNotes : undefined,
      }),
    onSuccess: () => {
      notify(isSigned ? "تم حفظ التعديلات على التقرير" : "تم حفظ المسودة")
      cancelEditing()
      void queryClient.invalidateQueries({ queryKey: ["encounter"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const aiDiagnosisMutation = useMutation({
    mutationFn: () => ehrApi.runAiDiagnosis(encounter!.encounterId),
    onSuccess: (data) => {
      setAiSuggestions(data)
      setSelectedAiIndices(data.diagnoses.map((_, i) => i))
      setShowAiModal(true)
      notify("تم توليد اقتراحات التشخيص بنجاح")
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const addDiagnosisItem = () => {
    if (!newDxName.trim()) return
    const newItem: StructuredDiagnosisDto = {
      name: newDxName.trim(),
      ...(newDxCode.trim() ? { code: newDxCode.trim() } : {}),
      type: newDxType,
      ...(newDxNotes.trim() ? { notes: newDxNotes.trim() } : {}),
    }
    setDraftDiagnoses((prev) => [...(prev ?? []), newItem])
    setNewDxName("")
    setNewDxCode("")
    setNewDxType("PRIMARY")
    setNewDxNotes("")
  }

  const removeDiagnosisItem = (index: number) => {
    setDraftDiagnoses((prev) => (prev ? prev.filter((_, i) => i !== index) : []))
  }

  const applyAiSuggestions = () => {
    if (!aiSuggestions) return
    const chosen = aiSuggestions.diagnoses.filter((_, i) => selectedAiIndices.includes(i))
    setDraftDiagnoses((prev) => {
      const current = prev ?? normalizeDiagnoses(encounter?.diagnoses ?? [])
      const names = new Set(current.map((d) => d.name))
      const toAdd = chosen.filter((c) => !names.has(c.name))
      return [...current, ...toAdd]
    })
    if (aiSuggestions.clinicalSummary) {
      setDraftDiagnosisNotes((prev) => {
        if (!prev || !prev.trim()) return aiSuggestions.clinicalSummary
        return `${prev}\n\n[ملخص AI]: ${aiSuggestions.clinicalSummary}`
      })
    }
    setShowAiModal(false)
    notify("تم تطبيق الاقتراحات في المسودة")
  }

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
    cancelEditing()
  }

  const soapForDisplay =
    draftSoap ?? {
        S: encounter?.soap?.S ?? "",
        O: encounter?.soap?.O ?? "",
        A: encounter?.soap?.A ?? "",
        P: encounter?.soap?.P ?? "",
      }

  useEffect(() => {
    if (encounter?.soap || draftSoap) {
      setReviewChecks({
        S: Boolean((draftSoap?.S ?? encounter?.soap?.S ?? "").trim()),
        O: Boolean((draftSoap?.O ?? encounter?.soap?.O ?? "").trim()),
        A: Boolean((draftSoap?.A ?? encounter?.soap?.A ?? "").trim()),
        P: Boolean((draftSoap?.P ?? encounter?.soap?.P ?? "").trim()),
      })
    }
  }, [encounter?.encounterId, encounter?.soap, draftSoap])

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
                  if (editing) cancelEditing()
                  else startEditing()
                }}
              >
                {editing ? "إلغاء التعديل" : "تعديل التقرير"}
              </AppButton>
              <AppButton
                variant="outline"
                icon="sparkle"
                onClick={() => {
                  if (!editing) startEditing()
                  aiDiagnosisMutation.mutate()
                }}
                disabled={aiDiagnosisMutation.isPending}
              >
                {aiDiagnosisMutation.isPending ? "جارٍ التحليل..." : "تشخيص ذكي (AI)"}
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
            <>
              <AppButton
                variant="outline"
                onClick={() => {
                  if (editing) cancelEditing()
                  else startEditing()
                }}
              >
                {editing ? "إلغاء التعديل" : "تعديل التقرير"}
              </AppButton>
              <AppButton
                variant="outline"
                icon="sparkle"
                onClick={() => {
                  if (!editing) startEditing()
                  aiDiagnosisMutation.mutate()
                }}
                disabled={aiDiagnosisMutation.isPending}
              >
                {aiDiagnosisMutation.isPending ? "جارٍ التحليل..." : "تشخيص ذكي (AI)"}
              </AppButton>
              {editing && (
                <AppButton
                  variant="secondary"
                  icon="check"
                  onClick={() => saveMutation.mutate()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ التعديلات"}
                </AppButton>
              )}
              <AppButton variant="outline" icon="plus" onClick={() => setShowAddendum(true)}>
                إضافة ملحق
              </AppButton>
            </>
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

          <article className="soap-section">
            <div className="soap-letter">Dx</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
                <div>
                  <h3 style={{ margin: 0 }}>التشخيصات والملاحظات السريرية</h3>
                  <small style={{ color: "var(--muted)" }}>التشخيص النهائي والترميز (ICD-10) ومبررات القرار الطبي</small>
                </div>
                {editing && (
                  <AppButton
                    variant="outline"
                    icon="sparkle"
                    type="button"
                    onClick={() => aiDiagnosisMutation.mutate()}
                    disabled={aiDiagnosisMutation.isPending}
                  >
                    {aiDiagnosisMutation.isPending ? "جارٍ التحليل الذكي..." : "اقتراح بالذكاء الاصطناعي (AI)"}
                  </AppButton>
                )}
              </div>

              {!editing ? (
                <div>
                  {normalizeDiagnoses(encounter.diagnoses ?? []).length === 0 && !encounter.diagnosisNotes ? (
                    <p style={{ color: "var(--muted)", fontStyle: "italic", margin: "6px 0" }}>
                      لم يتم تسجيل تشخيصات بعد — اضغط "تعديل التقرير" لتسجيل التشخيص السريري أو تشغيل التحليل الذكي.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "8px" }}>
                      {normalizeDiagnoses(encounter.diagnoses ?? []).map((dx, i) => (
                        <div
                          key={i}
                          style={{
                            padding: "8px 12px",
                            borderRadius: "12px",
                            background: "oklch(1 0 0 / 0.06)",
                            border: "1px solid var(--border)",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "2px 7px",
                              borderRadius: "4px",
                              background: dx.type === "PRIMARY" ? "oklch(0.72 0.19 290 / 0.3)" : dx.type === "SECONDARY" ? "oklch(1 0 0 / 0.12)" : "oklch(0.8 0.15 90 / 0.25)",
                              color: dx.type === "PRIMARY" ? "oklch(0.92 0.08 290)" : dx.type === "SECONDARY" ? "oklch(1 0 0 / 0.85)" : "oklch(0.92 0.1 90)",
                              fontWeight: "bold",
                            }}
                          >
                            {diagnosisTypeLabel[dx.type ?? "PRIMARY"] ?? dx.type}
                          </span>
                          {dx.code && (
                            <span style={{ fontSize: "12.5px", background: "oklch(1 0 0 / 0.14)", color: "oklch(1 0 0 / 0.88)", padding: "2px 8px", borderRadius: "6px", fontWeight: "600" }}>
                              {dx.code}
                            </span>
                          )}
                          <strong style={{ fontSize: "12px" }}>{dx.name}</strong>
                          {dx.notes && (
                            <span style={{ fontSize: "11px", color: "var(--muted)", marginRight: "auto" }}>
                              {dx.notes}
                            </span>
                          )}
                        </div>
                      ))}
                      {encounter.diagnosisNotes && (
                        <div style={{ marginTop: "6px", padding: "10px", borderRadius: "8px", background: "oklch(1 0 0 / 0.07)", border: "1px solid oklch(1 0 0 / 0.18)" }}>
                          <strong style={{ fontSize: "11px", color: "var(--primary)" }}>ملخص ومبررات التشخيص السريري:</strong>
                          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--text)", whiteSpace: "pre-wrap" }}>
                            {encounter.diagnosisNotes}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                  {/* Current draft diagnoses list */}
                  {(draftDiagnoses ?? []).length === 0 ? (
                    <p style={{ color: "var(--muted)", fontStyle: "italic", fontSize: "11px", margin: 0 }}>
                      لا توجد تشخيصات مضافة حالياً. يمكنك إضافة تشخيص أدناه أو استخدام الاقتراح الذكي.
                    </p>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {(draftDiagnoses ?? []).map((dx, i) => (
                        <div
                          key={i}
                          style={{
                            padding: "6px 10px",
                            borderRadius: "8px",
                            background: "oklch(1 0 0 / 0.08)",
                            border: "1px solid var(--border)",
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            flexWrap: "wrap",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "10px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              background: dx.type === "PRIMARY" ? "oklch(0.72 0.19 290 / 0.3)" : dx.type === "SECONDARY" ? "oklch(1 0 0 / 0.12)" : "oklch(0.8 0.15 90 / 0.25)",
                              color: dx.type === "PRIMARY" ? "oklch(0.92 0.08 290)" : dx.type === "SECONDARY" ? "oklch(1 0 0 / 0.85)" : "oklch(0.92 0.1 90)",
                              fontWeight: "bold",
                            }}
                          >
                            {diagnosisTypeLabel[dx.type ?? "PRIMARY"] ?? dx.type}
                          </span>
                          {dx.code && (
                            <span style={{ fontSize: "12.5px", background: "oklch(1 0 0 / 0.14)", color: "oklch(1 0 0 / 0.88)", padding: "2px 8px", borderRadius: "6px" }}>
                              {dx.code}
                            </span>
                          )}
                          <strong style={{ fontSize: "12px" }}>{dx.name}</strong>
                          {dx.notes && (
                            <small style={{ color: "var(--muted)", marginRight: "auto" }}>{dx.notes}</small>
                          )}
                          <button
                            type="button"
                            onClick={() => removeDiagnosisItem(i)}
                            style={{
                              border: 0,
                              background: "transparent",
                              color: "oklch(0.76 0.16 15)",
                              cursor: "pointer",
                              fontSize: "16px",
                              fontWeight: "bold",
                              marginRight: dx.notes ? undefined : "auto",
                              padding: "0 6px",
                            }}
                            title="حذف هذا التشخيص"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add diagnosis form */}
                  <div style={{ padding: "10px", background: "oklch(1 0 0 / 0.06)", borderRadius: "12px", border: "1px dashed oklch(1 0 0 / 0.28)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr auto", gap: "8px", alignItems: "end" }}>
                      <div>
                        <span style={{ fontSize: "11px", fontWeight: "600", display: "block", marginBottom: "3px" }}>
                          اسم التشخيص <b style={{ color: "var(--danger)" }}>*</b>
                        </span>
                        <input
                          value={newDxName}
                          onChange={(e) => setNewDxName(e.target.value)}
                          placeholder="مثال: اضطراب اكتئابي جسيم"
                          style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1px solid oklch(1 0 0 / 0.25)", padding: "0 10px", fontSize: "14px", background: "oklch(0.25 0.03 280 / 0.55)", color: "var(--text-strong)" }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault()
                              addDiagnosisItem()
                            }
                          }}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: "11px", fontWeight: "600", display: "block", marginBottom: "3px" }}>
                          الرمز (ICD-10)
                        </span>
                        <input
                          value={newDxCode}
                          onChange={(e) => setNewDxCode(e.target.value)}
                          placeholder="مثال: F32.1"
                          style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1px solid oklch(1 0 0 / 0.25)", padding: "0 10px", fontSize: "14px", background: "oklch(0.25 0.03 280 / 0.55)", color: "var(--text-strong)" }}
                        />
                      </div>
                      <div>
                        <span style={{ fontSize: "11px", fontWeight: "600", display: "block", marginBottom: "3px" }}>
                          نوع التشخيص
                        </span>
                        <select
                          value={newDxType}
                          onChange={(e) => setNewDxType(e.target.value as any)}
                          style={{ width: "100%", height: "40px", borderRadius: "10px", border: "1px solid oklch(1 0 0 / 0.25)", padding: "0 10px", fontSize: "14px", background: "oklch(0.25 0.03 280 / 0.55)", color: "var(--text-strong)" }}
                        >
                          <option value="PRIMARY">رئيسي (PRIMARY)</option>
                          <option value="SECONDARY">ثانوي (SECONDARY)</option>
                          <option value="DIFFERENTIAL">تفريقي (DIFFERENTIAL)</option>
                        </select>
                      </div>
                      <AppButton
                        type="button"
                        variant="primary"
                        onClick={addDiagnosisItem}
                        disabled={!newDxName.trim()}
                      >
                        إضافة
                      </AppButton>
                    </div>
                    <div style={{ marginTop: "6px" }}>
                      <input
                        value={newDxNotes}
                        onChange={(e) => setNewDxNotes(e.target.value)}
                        placeholder="ملاحظات ومبررات حول هذا التشخيص (اختياري)..."
                        style={{ width: "100%", height: "38px", borderRadius: "10px", border: "1px solid oklch(1 0 0 / 0.25)", padding: "0 10px", fontSize: "13.5px", background: "oklch(0.25 0.03 280 / 0.55)", color: "var(--text-strong)" }}
                      />
                    </div>
                  </div>

                  {/* Free text diagnosis notes */}
                  <div>
                    <label style={{ display: "block", fontSize: "11px", fontWeight: "700", marginBottom: "3px" }}>
                      ملخص ومبررات التشخيص السريري (نص حر):
                    </label>
                    <textarea
                      value={draftDiagnosisNotes ?? ""}
                      onChange={(e) => setDraftDiagnosisNotes(e.target.value)}
                      rows={3}
                      placeholder="سجل مبررات التشخيص، تطور الأعراض، أو أي ملاحظات تشخيصية حرة..."
                      style={{ width: "100%", borderRadius: "8px", border: "1px solid var(--border)", padding: "8px", fontSize: "12px", resize: "vertical" }}
                    />
                  </div>
                </div>
              )}
            </div>
          </article>

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
            {(["S", "O", "A", "P"] as const).map((k) => {
              const isFilled = Boolean(soapForDisplay[k]?.trim())
              return (
                <label key={k} style={{ color: isFilled ? undefined : "var(--danger)" }}>
                  <input
                    type="checkbox"
                    checked={reviewChecks[k]}
                    disabled={!isDraft}
                    onChange={(e) => setReviewChecks({ ...reviewChecks, [k]: e.target.checked })}
                  />{" "}
                  قسم {k} — {sectionTitles[k].split("—")[0].trim()}{" "}
                  {!isFilled && <span style={{ fontSize: "11px", color: "var(--danger)" }}>(غير مكتمل)</span>}
                </label>
              )
            })}
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
      {showAiModal && aiSuggestions && (
        <Modal
          title="اقتراحات التشخيص بالذكاء الاصطناعي"
          subtitle="تم تحليل محتوى الجلسة السريرية واستخلاص التشخيصات المقترحة التالية. حدد ما ترغب بإضافته إلى مسودة التقرير."
          onClose={() => setShowAiModal(false)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxHeight: "400px", overflowY: "auto" }}>
            {aiSuggestions.diagnoses.map((dx, idx) => (
              <label
                key={idx}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "10px",
                  padding: "10px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: selectedAiIndices.includes(idx) ? "oklch(0.72 0.19 290 / 0.22)" : "oklch(1 0 0 / 0.06)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedAiIndices.includes(idx)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedAiIndices([...selectedAiIndices, idx])
                    else setSelectedAiIndices(selectedAiIndices.filter((i) => i !== idx))
                  }}
                  style={{ marginTop: "4px" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: "13px" }}>{dx.name}</strong>
                    {dx.code && (
                      <span style={{ fontSize: "12.5px", background: "oklch(1 0 0 / 0.14)", color: "oklch(1 0 0 / 0.88)", padding: "2px 8px", borderRadius: "6px", fontWeight: "bold" }}>
                        {dx.code}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: "10px",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: dx.type === "PRIMARY" ? "oklch(0.72 0.19 290 / 0.3)" : dx.type === "SECONDARY" ? "oklch(1 0 0 / 0.12)" : "oklch(0.8 0.15 90 / 0.25)",
                        color: dx.type === "PRIMARY" ? "oklch(0.92 0.08 290)" : dx.type === "SECONDARY" ? "oklch(1 0 0 / 0.85)" : "oklch(0.92 0.1 90)",
                        fontWeight: "bold",
                      }}
                    >
                      {diagnosisTypeLabel[dx.type ?? "PRIMARY"] ?? dx.type}
                    </span>
                  </div>
                  {dx.notes && <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--muted)" }}>{dx.notes}</p>}
                </div>
              </label>
            ))}
            {aiSuggestions.clinicalSummary && (
              <div style={{ padding: "10px", background: "oklch(1 0 0 / 0.06)", borderRadius: "12px", border: "1px solid oklch(1 0 0 / 0.18)" }}>
                <strong style={{ fontSize: "12px", display: "block", marginBottom: "4px", color: "var(--primary)" }}>ملخص التحليل السريري:</strong>
                <p style={{ margin: 0, fontSize: "13.5px", color: "oklch(1 0 0 / 0.88)" }}>{aiSuggestions.clinicalSummary}</p>
              </div>
            )}
          </div>
          <div className="modal-actions" style={{ marginTop: "16px" }}>
            <AppButton variant="outline" type="button" onClick={() => setShowAiModal(false)}>
              تخطي وإلغاء
            </AppButton>
            <AppButton
              variant="primary"
              type="button"
              onClick={applyAiSuggestions}
              disabled={selectedAiIndices.length === 0 && !aiSuggestions.clinicalSummary}
            >
              تطبيق الاقتراحات المحددة ({arNum(selectedAiIndices.length)})
            </AppButton>
          </div>
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
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), 350)
    return () => clearTimeout(timer)
  }, [trimmed])

  const searchQuery = useQuery({
    queryKey: ["patient-search", debounced],
    queryFn: () => patientsApi.search(debounced),
    enabled: debounced.length >= 3,
  })

  const candidates = searchQuery.data?.data ?? []
  const activePatientId =
    selectedPatientId && candidates.some((c) => c.id === selectedPatientId)
      ? selectedPatientId
      : candidates[0]?.id ?? null

  const chartQuery = useQuery({
    queryKey: ["chart", activePatientId ?? "none", "soap-picker"],
    queryFn: () => ehrApi.chart(activePatientId!, 10),
    enabled: activePatientId !== null,
  })

  if (debounced.length < 3) return null
  const activeCandidate = candidates.find((c) => c.id === activePatientId)
  const encounters = chartQuery.data?.encounters ?? []

  return (
    <div style={{ marginTop: "14px" }}>
      {candidates.length > 1 && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "10px" }}>
          {candidates.map((cand) => (
            <button
              key={cand.id}
              type="button"
              className={`chip ${cand.id === activePatientId ? "active" : ""}`}
              onClick={() => setSelectedPatientId(cand.id)}
            >
              {cand.fullName} ({cand.id.slice(-6)})
            </button>
          ))}
        </div>
      )}
      <div className="data-table">
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
            <strong>{activeCandidate?.fullName ?? "—"}</strong>
            <span>{enc.encounterId.slice(-6)}</span>
            <span>{arDate(enc.signedAt ?? enc.visitDate)}</span>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
    </div>
  )
}
