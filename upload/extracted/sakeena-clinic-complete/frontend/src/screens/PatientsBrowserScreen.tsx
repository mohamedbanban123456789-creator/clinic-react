/**
 * Patients browser (doctor) — reuses the Figma search design (large-search,
 * patient-match cards) to find and open patient files.
 */

import { useEffect, useState } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { patientsApi } from "@/api/patients"
import { arAgo, arNum, ageFromDob, formatPhone } from "@/lib/format"
import { Icon } from "@/components/ui"
import type { PatientSearchCandidateDto } from "@/api/types"

export default function PatientsBrowserScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [query, setQuery] = useState(params.get("q") ?? "")
  const [debounced, setDebounced] = useState(query)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  const searchQuery = useQuery({
    queryKey: ["patient-search", debounced],
    queryFn: () => patientsApi.search(debounced),
    enabled: debounced.length >= 3,
  })

  const results: PatientSearchCandidateDto[] = searchQuery.data?.data ?? []

  const open = (candidate: PatientSearchCandidateDto) => {
    navigate(`/doctor/patients/${candidate.id}`)
  }

  return (
    <section className="card form-card">
      <div className="step-header">
        <span className="step-no">١</span>
        <div>
          <h2>ابحث في ملفات المرضى</h2>
          <p>ابحث بالاسم أو رقم الهاتف لفتح الملف الطبي.</p>
        </div>
      </div>
      <label className="large-search">
        <Icon name="search" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="مثال: نهى عادل أو ٠١٠..."
          autoFocus
        />
      </label>
      {query.length > 0 && query.length < 3 && (
        <p className="field-error">اكتب ٣ أحرف على الأقل للبحث.</p>
      )}
      {searchQuery.isFetching && query.length >= 3 && (
        <p className="field-error">جارٍ البحث…</p>
      )}
      {query.length >= 3 && !searchQuery.isFetching && results.length === 0 && (
        <div className="search-hint">
          <Icon name="users" size={34} />
          <h3>لا نتائج مطابقة</h3>
          <p>جرّب بيانات بحث مختلفة.</p>
        </div>
      )}
      {results.map((candidate) => (
        <button
          key={candidate.id}
          className="patient-match selectable"
          onClick={() => open(candidate)}
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
                  : "—"}{" "}
                · آخر زيارة: {candidate.lastVisitAt ? arAgo(candidate.lastVisitAt) : "أول زيارة"}
                {candidate.phoneLast4 ? (
                  <> · هاتف: <span className="phone-display">{formatPhone(candidate.phone, candidate.phoneLast4, "DOCTOR")}</span></>
                ) : null}
              </p>
            </div>
            <span className="match-label">
              {candidate.hasDebtAlert ? (
                <>
                  <Icon name="alert" size={14} /> رصيد
                </>
              ) : (
                <>
                  <Icon name="chevron" size={14} /> فتح
                </>
              )}
            </span>
          </div>
        </button>
      ))}
      {!query && (
        <div className="search-hint">
          <Icon name="users" size={34} />
          <h3>ابدأ بكتابة بيانات المريض</h3>
          <p>الملف السريري (السجل الزمني، التقارير، الأدوية) متاح لحساب الطبيب فقط.</p>
        </div>
      )}
    </section>
  )
}
