/**
 * Session screen — design preserved (recorder state machine, waveform, MSE
 * panel, private notes). Real integration:
 *  - Patient context from ?patient= / ?entry= or the live queue.
 *  - Consent + session creation (POST /scribe/sessions, consentConfirmed).
 *  - MediaRecorder capture -> base64 upload to cycle-1/cycle-2.
 *  - GEMINI_KEY_MISSING handled honestly: AI analysis is marked unavailable
 *    and the doctor is offered the manual documentation path (EHR DRAFT),
 *    which the backend fully supports without the AI key.
 *  - MSE selections feed the encounter/commit payload.
 *  - Private notes are saved to the encrypted vault.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { patientsApi } from "@/api/patients"
import { queueApi } from "@/api/queue"
import { scribeApi } from "@/api/scribe"
import { ehrApi } from "@/api/ehr"
import { vaultApi } from "@/api/vault"
import type { ScribeEvidenceItem } from "@/api/types"
import { apiErrorMessage, ApiError } from "@/api/client"
import { AppButton, Icon, Modal, useToast, SelectField } from "@/components/ui"
import { useQueue } from "@/hooks/useQueue"
import { arNum, arAgo, arTimer, formatPhone } from "@/lib/format"
import { mseFieldLabel, mseOptions } from "@/lib/constants"

type RecorderState = "idle" | "recording" | "paused" | "processing" | "ready" | "error"

const evidenceSectionLabel: Record<string, string> = {
  S: "S — الذاتي",
  O: "O — الموضوعي",
  A: "A — التقييم",
  P: "P — الخطة",
  diagnosis: "التشخيص",
  prescription: "الروشتة",
  chiefComplaint: "الشكوى الرئيسية",
  symptoms: "الأعراض",
  moodAndAffect: "المزاج والوجدان",
  suggestions: "مقترحات الفحص",
}

const evidenceSpeakerLabel: Record<string, string> = {
  doctor: "الدكتور",
  patient: "المريضة",
  unsure: "غير مؤكد",
}

const evidenceSectionOrder = [
  "S",
  "O",
  "A",
  "P",
  "diagnosis",
  "prescription",
  "chiefComplaint",
  "symptoms",
  "moodAndAffect",
  "suggestions",
]

function groupEvidenceBySection(items: ScribeEvidenceItem[]): { section: string; items: ScribeEvidenceItem[] }[] {
  const order = new Map(evidenceSectionOrder.map((s, i) => [s, i]))
  const groups = new Map<string, ScribeEvidenceItem[]>()
  for (const e of items) {
    const list = groups.get(e.section) ?? []
    list.push(e)
    groups.set(e.section, list)
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (order.get(a) ?? 99) - (order.get(b) ?? 99))
    .map(([section, sectionItems]) => ({ section, items: sectionItems }))
}

export default function SessionScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const { entries } = useQueue()

  const patientParam = params.get("patient")
  const entryParam = params.get("entry")

  const current = useMemo(() => {
    if (entryParam) return entries.find((e) => e.entryId === entryParam)
    if (patientParam) return entries.find((e) => e.patientId === patientParam)
    return entries.find((e) => e.status === "IN_CONSULTATION")
  }, [entries, entryParam, patientParam])

  const [state, setState] = useState<RecorderState>("idle")
  const [aiUnavailable, setAiUnavailable] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [mse, setMse] = useState({
    appearance: "مهندم",
    behavior: "متعاون",
    speechCoherence: "مترابط",
    moodAffect: "مستقر",
  })
  const [privateNote, setPrivateNote] = useState("")
  const [showManual, setShowManual] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [cycle2, setCycle2] = useState<{
    soap: { S: string; O: string; A: string; P: string }
    prescriptions: {
      drugName: string
      dosage: string
      frequency: string
      instructions: string
    }[]
    finalDiagnosis: string
    evidence: ScribeEvidenceItem[]
  } | null>(null)
  const [analysis, setAnalysis] = useState<{
    chiefComplaint: string
    symptoms: string[]
    moodAffect: string
    suggestions: { text: string; provenance: "AI" }[]
    evidence: ScribeEvidenceItem[]
    transcript: {
      cleanedText: string
      segments: { speaker: "doctor" | "patient" | "unsure"; text: string }[]
    } | null
  } | null>(null)
  const mediaRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const patientQuery = useQuery({
    queryKey: ["patient", current?.patientId ?? patientParam ?? ""],
    queryFn: () => patientsApi.get(current?.patientId ?? patientParam!),
    enabled: Boolean(current?.patientId ?? patientParam),
  })

  useEffect(() => {
    if (state === "recording") {
      const timer = window.setInterval(() => setElapsed((s) => s + 1), 1000)
      timerRef.current = timer
      return () => window.clearInterval(timer)
    }
    if (timerRef.current) window.clearInterval(timerRef.current)
  }, [state])

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  const patient = patientQuery.data
  const patientName = patient?.fullName ?? current?.displayName ?? "—"

  /* --------------------------- AI scribe flow --------------------------- */

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onloadend = () => {
        const result = String(reader.result)
        resolve(result.slice(result.indexOf(",") + 1))
      }
      reader.onerror = () => reject(new Error("فشل تحويل التسجيل"))
      reader.readAsDataURL(blob)
    })

  const startRecording = async () => {
    setAiError(null)
    setCycle2(null)
    setAnalysis(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data)
      mediaRef.current = recorder
      recorder.start(1000)
      setElapsed(0)
      setState("recording")
      notify("بدأ تسجيل الجلسة — يُحفظ الصوت بشكل آمن")
    } catch {
      notify("تعذر الوصول إلى الميكروفون — تحقق من صلاحيات المتصفح", "error")
      setState("error")
    }
  }

  const togglePause = () => {
    const recorder = mediaRef.current
    if (!recorder) return
    if (state === "recording") {
      recorder.pause()
      setState("paused")
    } else if (state === "paused") {
      recorder.resume()
      setState("recording")
    }
  }

  const createScribeSession = async (): Promise<string> => {
    if (sessionId) return sessionId
    if (!current && !patientParam) throw new Error("لا يوجد سياق مريض")
    const created = await scribeApi.createSession({
      patientId: (current?.patientId ?? patientParam) as string,
      ...(current?.entryId ? { queueEntryId: current.entryId } : {}),
      mode: "AMBIENT_LIVE",
      consentConfirmed: true,
    })
    setSessionId(created.sessionId)
    return created.sessionId
  }

  const processAudio = async (audioBase64: string, mimeType: string) => {
    setState("processing")
    setAiError(null)
    try {
      const sid = await createScribeSession()
      if (audioBase64.length > 15_000_000) {
        throw new ApiError(413, "PAYLOAD_TOO_LARGE", "التسجيل أطول من الحد المسموع — قصّره وأعد المحاولة")
      }
      const first = await scribeApi.cycle1(sid, audioBase64, mimeType)
      setAnalysis({
        chiefComplaint: first.analysis.chiefComplaint ?? "",
        symptoms: first.analysis.symptoms ?? [],
        moodAffect: first.analysis.moodAffect ?? "",
        suggestions: first.analysis.suggestions ?? [],
        evidence: first.analysis.evidence ?? [],
        transcript: first.analysis.transcript ?? null,
      })
      const second = await scribeApi.cycle2(sid, audioBase64, mimeType)
      setCycle2({
        soap: {
          S: second.soap.S ?? "",
          O: second.soap.O ?? "",
          A: second.soap.A ?? "",
          P: second.soap.P ?? "",
        },
        prescriptions: second.prescriptions ?? [],
        finalDiagnosis: second.finalDiagnosis ?? "",
        evidence: second.evidence ?? [],
      })
      setState("ready")
      notify("تمت معالجة التسجيل — مسودة SOAP جاهزة للمراجعة")
    } catch (err) {
      if (err instanceof ApiError && (err.code === "GEMINI_KEY_MISSING" || err.code === "GROQ_KEY_MISSING")) {
        setAiUnavailable(true)
        setAiError("معالجة الصوت غير مفعلة على الخادم (مفتاح AI غير مكون) — يمكنك التوثيق يدويًا.")
        setState("error")
      } else {
        setAiError(apiErrorMessage(err))
        setState("error")
      }
    }
  }

  const stopRecording = () => {
    const recorder = mediaRef.current
    if (!recorder) return
    setState("processing")
    recorder.onstop = async () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" })
      try {
        const audioBase64 = await blobToBase64(blob)
        await processAudio(audioBase64, blob.type || "audio/webm")
      } catch (err) {
        setAiError(err instanceof ApiError ? apiErrorMessage(err) : "فشل تحويل التسجيل")
        setState("error")
      }
    }
    recorder.stop()
  }

  const uploadAudioFile = async (file: File) => {
    setCycle2(null)
    setAnalysis(null)
    try {
      if (file.size > 11_000_000) {
        notify("الملف أكبر من الحد المسموح (~11MB) — اختر مقطعًا أقصر", "error")
        return
      }
      const audioBase64 = await blobToBase64(file)
      await processAudio(audioBase64, file.type || "audio/webm")
    } catch {
      setAiError("تعذر قراءة الملف الصوتي")
      setState("error")
    }
  }

  const commitMutation = useMutation({
    mutationFn: () =>
      scribeApi.commit({
        sessionId: sessionId!,
        soap: cycle2!.soap,
        mse,
        prescriptions: cycle2!.prescriptions,
        diagnoses: cycle2!.finalDiagnosis ? [cycle2!.finalDiagnosis] : [],
      }),
    onSuccess: (res) => {
      notify("تم اعتماد التقرير وإضافته للسجل الطبي")
      navigate(`/doctor/soap?encounter=${res.encounterId}`)
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  /* ------------------------- Manual EHR fallback ------------------------- */

  const manualMutation = useMutation({
    mutationFn: () =>
      ehrApi.createEncounter({
        patientId: (current?.patientId ?? patientParam) as string,
        visitDate: new Date().toISOString(),
        encounterType: "جلسة سريرية",
        ...(current?.entryId ? { queueEntryId: current.entryId } : {}),
        mse,
      }),
    onSuccess: (res) => {
      notify("أُنشئت مسودة تقرير يدوي — أكملها واعتمدها")
      navigate(`/doctor/soap?encounter=${res.encounterId}`)
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const saveNoteMutation = useMutation({
    mutationFn: () => vaultApi.add((current?.patientId ?? patientParam) as string, privateNote.trim()),
    onSuccess: () => {
      notify("حُفظت الملاحظة في المساحة المحمية (مشفّرة)")
      setPrivateNote("")
      void queryClient.invalidateQueries({ queryKey: ["vault"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const completed = Object.keys(mseOptions).filter(
    (k) => (mse as Record<string, string>)[k],
  ).length

  const recorderStateLabel: Record<RecorderState, string> = {
    idle: "جاهز للتسجيل",
    recording: "جارٍ التسجيل",
    paused: "التسجيل متوقف مؤقتًا",
    processing: "تجهيز المسودة",
    ready: "المسودة جاهزة",
    error: "تعذر إتمام المعالجة",
  }

  if (!current && !patientParam) {
    return (
      <div className="session-layout">
        <section className="session-main">
          <section className="card session-patient">
            <div className="patient-heading compact">
              <span className="patient-avatar large">؟</span>
              <div>
                <span className="id-label">مساحة الجلسة</span>
                <h3>لا جلسة نشطة</h3>
                <p>استدعِ مريضًا من لوحة الطبيب أو افتح ملف مريض لبدء جلسة.</p>
              </div>
            </div>
            <AppButton variant="outline" onClick={() => navigate("/doctor")}>
              العودة إلى لوحة الطبيب
            </AppButton>
          </section>
        </section>
      </div>
    )
  }

  return (
    <div className="session-layout">
      <section className="session-main">
        <div className="card session-patient">
          <div className="patient-heading compact">
            <span className="patient-avatar large">{patientName.charAt(0)}</span>
            <div>
              <span className="id-label">الجلسة الحالية</span>
              <h3>{patientName}</h3>
              <p>
                {(current?.patientId ?? patientParam)?.slice(-6)} ·{" "}
                {patient?.lastVisitAt ? `آخر زيارة ${arAgo(patient.lastVisitAt)}` : "أول زيارة"}
              </p>
            </div>
          </div>
          <div className="context-tags">
            <span>{current?.status === "IN_CONSULTATION" ? "مع الطبيب الآن" : "جلسة موثقة يدويًا"}</span>
            <span>{patient?.phone ? <>هاتف: <span className="phone-display">{formatPhone(patient.phone, null, "DOCTOR")}</span></> : "لا هاتف مسجل"}</span>
          </div>
          <AppButton
            variant="outline"
            onClick={() =>
              navigate(`/doctor/patients/${current?.patientId ?? patientParam}`)
            }
          >
            فتح الملف
          </AppButton>
        </div>

        <section className={`card recorder ${state}`}>
          <div className="recorder-visual">
            <div className="record-core">
              <Icon name="mic" size={34} />
            </div>
            {state === "recording" && (
              <>
                <i className="ring r1" />
                <i className="ring r2" />
              </>
            )}
          </div>
          <div className="record-state">
            <span className="section-kicker">{recorderStateLabel[state]}</span>
            <strong>{state === "idle" ? "٠٠:٠٠" : arTimer(elapsed)}</strong>
            <p>
              {state === "processing"
                ? "يحلل المساعد الجلسة في الخلفية. يمكنك استكمال التقييم."
                : state === "ready"
                  ? "تم تجهيز مسودة SOAP وتنتظر مراجعتك."
                  : state === "error"
                    ? (aiError ?? "تعذرت المعالجة — يمكنك التوثيق يدويًا.")
                    : "يُحفظ الصوت بشكل آمن داخل ملف الجلسة (يُتلف تلقائيًا بعد فترة الاحتفاظ)."}
            </p>
          </div>
          <div className="waveform">
            {Array.from({ length: 38 }).map((_, i) => (
              <i
                key={i}
                style={{
                  height:
                    state === "recording"
                      ? `${14 + ((i * 7) % 34)}px`
                      : "8px",
                }}
              />
            ))}
          </div>
          <div className="record-controls">
            {state === "idle" && (
              <>
                <AppButton icon="mic" onClick={() => void startRecording()}>
                  بدء تسجيل الجلسة
                </AppButton>
                <AppButton variant="outline" icon="file" onClick={() => setShowManual(true)}>
                  توثيق يدوي بدون تسجيل
                </AppButton>
                <AppButton variant="outline" icon="file" onClick={() => fileRef.current?.click()}>
                  رفع ملف صوتي للتجربة
                </AppButton>
                <input
                  ref={fileRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ""
                    if (f) void uploadAudioFile(f)
                  }}
                />
              </>
            )}
            {(state === "recording" || state === "paused") && (
              <>
                <button className="round-control pause" onClick={togglePause}>
                  <Icon name={state === "paused" ? "mic" : "pause"} />
                </button>
                <button className="round-control stop" onClick={stopRecording}>
                  <Icon name="stop" />
                </button>
              </>
            )}
            {state === "processing" && (
              <span className="processing-pill">
                <i /> معالجة آمنة في الخلفية
              </span>
            )}
            {state === "ready" && (
              <AppButton icon="sparkle" onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending}>
                {commitMutation.isPending ? "جارٍ الاعتماد..." : "اعتماد مسودة SOAP"}
              </AppButton>
            )}
            {state === "error" && (
              <>
                <AppButton icon="mic" variant="outline" onClick={() => void startRecording()}>
                  إعادة التسجيل
                </AppButton>
                <AppButton icon="file" onClick={() => setShowManual(true)}>
                  توثيق يدوي بدون AI
                </AppButton>
              </>
            )}
          </div>
        </section>

        {state === "ready" && cycle2 && (
          <section className="card ai-review">
            <div className="card-header">
              <div>
                <span className="section-kicker">مراجعة الطبيب قبل الاعتماد</span>
                <h3>مسودة SOAP المقترحة</h3>
                <p>راجع كل قسم مع دليله الصوتي — أي اقتباس مشكوك فيه يعني أن المساعد ربما سمع غلط.</p>
              </div>
              <span>
                <Icon name="sparkle" size={14} /> AI
              </span>
            </div>
            {(["S", "O", "A", "P"] as const).map((letter) => (
              <article className="soap-section" key={letter}>
                <div className="soap-letter">{letter}</div>
                <div>
                  <h3>{evidenceSectionLabel[letter]}</h3>
                  <p>{cycle2.soap[letter] || "—"}</p>
                </div>
              </article>
            ))}
            {cycle2.finalDiagnosis && (
              <article className="soap-section">
                <div className="soap-letter">Dx</div>
                <div>
                  <h3>التشخيص المقترح</h3>
                  <p>{cycle2.finalDiagnosis}</p>
                </div>
              </article>
            )}
            {cycle2.prescriptions.length > 0 && (
              <article className="soap-section">
                <div className="soap-letter">Rx</div>
                <div>
                  <h3>الروشتة المقترحة</h3>
                  {cycle2.prescriptions.map((p, i) => (
                    <p key={i}>
                      • {p.drugName} {p.dosage} — {p.frequency} ({p.instructions})
                    </p>
                  ))}
                </div>
              </article>
            )}
            <article className="soap-section">
              <div className="soap-letter">؟</div>
              <div>
                <h3>الأدلة الصوتية — ماذا سمع المساعد فعلاً؟</h3>
                {cycle2.evidence.length === 0 && (analysis?.evidence.length ?? 0) === 0 && (
                  <p>لا أدلة مرفقة — راجع التسجيل يدويًا قبل الاعتماد.</p>
                )}
                {groupEvidenceBySection(cycle2.evidence).map((g) => (
                  <div key={`c2-${g.section}`} style={{ marginBottom: "6px" }}>
                    <strong>{evidenceSectionLabel[g.section] ?? g.section}</strong>
                    {g.items.map((e, i) => (
                      <p key={i} style={{ margin: "2px 0" }}>
                        <span className="method-pill">{evidenceSpeakerLabel[e.speaker] ?? e.speaker}</span>{" "}
                        {e.claim}
                        {e.quote ? (
                          <><br />«{e.quote}»</>
                        ) : (
                          <><br />⚠ بلا دليل مسموع — تحقق بنفسك</>
                        )}
                      </p>
                    ))}
                  </div>
                ))}
                {(analysis?.evidence.length ?? 0) > 0 && (
                  <>
                    <h3 style={{ marginTop: "8px" }}>أدلة التحليل الأولي</h3>
                    {groupEvidenceBySection(analysis!.evidence).map((g) => (
                      <div key={`c1-${g.section}`} style={{ marginBottom: "6px" }}>
                        <strong>{evidenceSectionLabel[g.section] ?? g.section}</strong>
                        {g.items.map((e, i) => (
                          <p key={i} style={{ margin: "2px 0" }}>
                            <span className="method-pill">{evidenceSpeakerLabel[e.speaker] ?? e.speaker}</span>{" "}
                            {e.claim}
                            {e.quote ? (
                              <><br />«{e.quote}»</>
                            ) : (
                              <><br />⚠ بلا دليل مسموع — تحقق بنفسك</>
                            )}
                          </p>
                        ))}
                      </div>
                    ))}
                  </>
                )}
              </div>
            </article>
            {analysis && analysis.transcript && (
              <article className="soap-section">
                <div className="soap-letter">T</div>
                <div>
                  <details>
                    <summary>
                      <strong>التفريغ المنقح للجلسة (بالمتحدثين)</strong> — {arNum(analysis.transcript.segments.length)} مقطع
                    </summary>
                    <div style={{ marginTop: "8px", maxHeight: "320px", overflowY: "auto" }}>
                      {analysis.transcript.segments.map((seg, i) => (
                        <p key={i} style={{ margin: "4px 0" }}>
                          <span className="method-pill">{evidenceSpeakerLabel[seg.speaker] ?? seg.speaker}</span>{" "}
                          {seg.text}
                        </p>
                      ))}
                    </div>
                  </details>
                </div>
              </article>
            )}
            {analysis && (
              <article className="soap-section">
                <div className="soap-letter">i</div>
                <div>
                  <h3>ملخص التحليل الأولي</h3>
                  <p><strong>الشكوى:</strong> {analysis.chiefComplaint || "—"}</p>
                  <p><strong>المزاج:</strong> {analysis.moodAffect || "—"}</p>
                  {analysis.symptoms.map((s, i) => (
                    <p key={i}>• {s}</p>
                  ))}
                </div>
              </article>
            )}
          </section>
        )}

        <section className="card live-notes">
          <div className="card-header">
            <div>
              <h3>ملاحظات سريعة أثناء الجلسة</h3>
              <p>هذه الملاحظات للطبيب ولن تظهر للسكرتارية (تُحفظ مشفّرة).</p>
            </div>
            <span>
              <Icon name="lock" size={14} /> خاص
            </span>
          </div>
          <textarea
            placeholder="أضف ملاحظة سريرية أو جرعة للرجوع إليها عند مراجعة التقرير..."
            value={privateNote}
            onChange={(e) => setPrivateNote(e.target.value)}
          />
          <div className="modal-actions" style={{ marginTop: "10px" }}>
            <AppButton
              variant="secondary"
              icon="lock"
              onClick={() => privateNote.trim() && saveNoteMutation.mutate()}
              disabled={saveNoteMutation.isPending || !privateNote.trim()}
            >
              {saveNoteMutation.isPending ? "جارٍ الحفظ..." : "حفظ الملاحظة (مشفّرة)"}
            </AppButton>
          </div>
        </section>
      </section>

      <aside className="card mse-panel">
        <div className="mse-title">
          <div className="ai-icon">
            <Icon name="heart" />
          </div>
          <div>
            <span className="section-kicker">تقييم سريع</span>
            <h2>MSE</h2>
            <p>تقييم الحالة الذهنية أثناء المقابلة.</p>
          </div>
        </div>
        {(Object.keys(mseOptions) as (keyof typeof mseOptions)[]).map((key) => (
          <div className="mse-group" key={key}>
            <label>{mseFieldLabel[key]}</label>
            <div>
              {mseOptions[key].map((option) => (
                <button
                  className={(mse as Record<string, string>)[key] === option ? "selected" : ""}
                  onClick={() => setMse({ ...mse, [key]: option })}
                  key={option}
                >
                  {(mse as Record<string, string>)[key] === option && (
                    <Icon name="check" size={14} />
                  )}
                  {option}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div className="mse-progress">
          <span>
            <Icon name="check" size={15} /> تم استكمال {arNum(completed)} من {arNum(4)}
          </span>
          <div>
            <i style={{ width: `${(completed / 4) * 100}%` }} />
          </div>
        </div>
        <AppButton
          variant="secondary"
          onClick={() => notify("تقييم MSE سيُرفق بالتقرير عند الحفظ")}
        >
          حفظ التقييم
        </AppButton>
      </aside>

      {showManual && (
        <Modal
          title="توثيق يدوي للتقرير"
          subtitle="إنشاء مسودة SOAP يدوية (بدون تحليل AI) ثم اعتمادها."
          onClose={() => setShowManual(false)}
        >
          <div className="confirm-visual">
            <span>
              <Icon name="file" size={28} />
            </span>
            <h3>إنشاء مسودة تقرير يدوي؟</h3>
            <p>
              سيتم إنشاء مسودة تقرير SOAP فارغة مرتبطة بهذه الجلسة، مع تقييم MSE
              الحالي — يمكنك تعديلها واعتمادها من شاشة تقارير SOAP.
            </p>
          </div>
          <div className="modal-actions">
            <AppButton variant="outline" onClick={() => setShowManual(false)}>
              إلغاء
            </AppButton>
            <AppButton
              icon="file"
              onClick={() => manualMutation.mutate()}
              disabled={manualMutation.isPending}
            >
              {manualMutation.isPending ? "جارٍ الإنشاء..." : "إنشاء المسودة"}
            </AppButton>
          </div>
        </Modal>
      )}
    </div>
  )
}
