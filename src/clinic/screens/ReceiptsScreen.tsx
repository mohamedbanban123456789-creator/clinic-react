/**
 * Receipts archive — design preserved; role-aware data access per the
 * backend's blind-count rules (DB-10):
 *  - DOCTOR: unscoped archive (GET /receipts) with cursor pagination.
 *  - SECRETARY: unscoped reads are rejected — the archive is scoped by
 *    PATIENT via the toolbar search (patient-scoped history stays readable
 *    once the matching receipts sit on closed shifts; today's open-shift
 *    rows are withheld by the server).
 * Receipt detail modal joins the invoice + patient for full context; the
 * doctor can issue partial/full reversals from the modal.
 */

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { billingApi } from "@/clinic/api/billing"
import { patientsApi } from "@/clinic/api/patients"
import { apiErrorMessage } from "@/clinic/api/client"
import { AppButton, Icon, Modal, useToast, SkeletonBlock } from "@/clinic/components/ui"
import { useAuth } from "@/clinic/auth/AuthContext"
import { arDateTimeCompact, arNum, moneyMinor, minorToMajor } from "@/clinic/lib/format"
import { methodLabel } from "@/clinic/lib/constants"
import type { InvoiceListItemDto, ReceiptDto } from "@/clinic/api/types"

function ReceiptDetailModal({
  receipt,
  onClose,
}: {
  receipt: ReceiptDto
  onClose: () => void
}) {
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const [reverseAmount, setReverseAmount] = useState("")
  const [reverseReason, setReverseReason] = useState("")

  const patientQuery = useQuery({
    queryKey: ["patient", receipt.patientId],
    queryFn: () => patientsApi.get(receipt.patientId),
    staleTime: 600_000,
  })
  const patientName = patientQuery.data?.fullName ?? receipt.patientId.slice(-6)

  const invoiceQuery = useQuery({
    queryKey: ["billing", "for-receipt", receipt.patientId],
    queryFn: () => billingApi.invoices({ patientId: receipt.patientId, limit: 100 }),
  })

  const reverseMutation = useMutation({
    mutationFn: () =>
      billingApi.reverse(
        receipt.receiptId,
        Math.round(Number(reverseAmount) * 100),
        reverseReason.trim(),
      ),
    onSuccess: () => {
      notify("تم إصدار إيصال عكسي — الحالة مُحدّثة")
      onClose()
      void queryClient.invalidateQueries({ queryKey: ["receipts"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const invoice: InvoiceListItemDto | null =
    invoiceQuery.data?.data.find((inv) => inv.invoiceId === receipt.invoiceId) ?? null

  return (
    <Modal
      title="تفاصيل الإيصال"
      subtitle={`مرجع ${receipt.receiptId.slice(-6).toUpperCase()}`}
      onClose={onClose}
    >
      <div className="receipt-paper">
        <div className="receipt-brand">
          <div className="brand-mark small">
            <Icon name="heart" size={18} />
          </div>
          <div>
            <strong>عيادة سكينة للصحة النفسية</strong>
            <small>القاهرة، جمهورية مصر العربية</small>
          </div>
          <span className="paid-stamp">
            {receipt.type === "REVERSAL" ? "عكس عملية" : "إيصال تحصيل"}
          </span>
        </div>
        <div className="receipt-info">
          <span>
            <small>المريض</small>
            <strong>{patientName}</strong>
          </span>
          <span>
            <small>رقم الملف</small>
            <strong>{receipt.patientId.slice(-6)}</strong>
          </span>
          <span>
            <small>التاريخ</small>
            <strong>{arDateTimeCompact(receipt.createdAt)}</strong>
          </span>
        </div>
        <div className="receipt-lines">
          {invoice && (
            <>
              <span>
                <b>قيمة الزيارة</b>
                <b>{moneyMinor(invoice.finalFeeMinor)}</b>
              </span>
              {invoice.discountMinor > 0 && (
                <span>
                  <i>خصم — {invoice.discountReason ?? ""}</i>
                  <i>- {moneyMinor(invoice.discountMinor)}</i>
                </span>
              )}
            </>
          )}
          <span className="receipt-total">
            <b>{receipt.type === "REVERSAL" ? "مبلغ معكوس" : "المبلغ المحصّل"}</b>
            <b>{moneyMinor(receipt.amountMinor)}</b>
          </span>
          <span>
            <i>طريقة الدفع</i>
            <i>{methodLabel(receipt.method)}</i>
          </span>
          {invoice && (
            <span className="receipt-due">
              <b>الرصيد المتبقي للفاتورة</b>
              <b>{moneyMinor(invoice.outstandingMinor)}</b>
            </span>
          )}
        </div>
        <p className="receipt-footnote">
          تم إصدار هذا الإيصال إلكترونيًا بواسطة نظام سكينة. سيظهر الرصيد المتبقي
          تلقائيًا عند الزيارة القادمة.
        </p>
      </div>
      {isDoctor && receipt.type === "CHARGE" && (
        <form
          className="modal-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (Number(reverseAmount) > 0 && reverseReason.trim().length >= 1) {
              reverseMutation.mutate()
            }
          }}
        >
          <div className="form-row">
            <label className="field money-field">
              <span>عكس مبلغ (ج.م.)</span>
              <input
                type="number"
                value={reverseAmount}
                onChange={(e) => setReverseAmount(e.target.value)}
                placeholder={`حتى ${arNum(minorToMajor(receipt.amountMinor))}`}
              />
              <i>ج.م.</i>
            </label>
            <label className="field">
              <span>سبب العكس</span>
              <input
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                placeholder="مثال: خطأ في إدخال المبلغ"
              />
            </label>
          </div>
          <div className="modal-actions">
            <AppButton
              type="submit"
              variant="danger"
              disabled={reverseMutation.isPending || Number(reverseAmount) <= 0}
            >
              {reverseMutation.isPending ? "جارٍ التنفيذ..." : "إصدار عكس العملية"}
            </AppButton>
          </div>
        </form>
      )}
      <div className="modal-actions">
        <AppButton variant="outline" onClick={onClose}>
          إغلاق
        </AppButton>
        <AppButton icon="receipt" onClick={() => window.print()}>
          طباعة الإيصال
        </AppButton>
      </div>
    </Modal>
  )
}

export default function ReceiptsScreen() {
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"
  const [page, setPage] = useState(0)
  const [filter, setFilter] = useState("all")
  const [selected, setSelected] = useState<ReceiptDto | null>(null)
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")
  const [scopePatient, setScopePatient] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [search])

  const patientSearchQuery = useQuery({
    queryKey: ["patient-search", debounced],
    queryFn: () => patientsApi.search(debounced),
    enabled: debounced.length >= 3,
  })

  const receiptsQuery = useQuery({
    queryKey: [
      "receipts",
      "page",
      page,
      isDoctor ? "all" : scopePatient?.id ?? "none",
    ],
    queryFn: () =>
      billingApi.receipts({
        limit: 50,
        cursor: page === 0 ? undefined : String(page),
        ...(isDoctor ? {} : { patientId: scopePatient!.id }),
      }),
    enabled: isDoctor || Boolean(scopePatient),
  })

  const receipts = receiptsQuery.data?.data ?? []
  const nextCursor = receiptsQuery.data?.nextCursor ?? null

  const filtered = useMemo(
    () =>
      receipts.filter((r) => {
        if (filter === "cash") return r.method === "CASH"
        if (filter === "other") return r.method === "OTHER"
        if (filter === "charge") return r.type === "CHARGE"
        if (filter === "reversal") return r.type === "REVERSAL"
        return true
      }),
    [receipts, filter],
  )

  const searchCandidates = patientSearchQuery.data?.data ?? []

  return (
    <section className="card archive-card">
      <div className="card-header">
        <div>
          <span className="section-kicker">السجل المالي</span>
          <h2>أرشيف الإيصالات الإلكترونية</h2>
          <p>
            {isDoctor
              ? "ابحث واستعرض تفاصيل كل عملية تحصيل."
              : "ابحث باسم المريض لعرض سجل إيصالاته."}
          </p>
        </div>
      </div>
      <div className="archive-toolbar">
        <label className="large-search">
          <Icon name="search" size={18} />
          <input
            placeholder={
              isDoctor
                ? "تصفية نتائج الصفحة الحالية..."
                : "ابحث باسم المريض لعرض إيصالاته (٣ أحرف على الأقل)..."
            }
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">كل العمليات</option>
          <option value="charge">تحصيل فقط</option>
          <option value="reversal">عمليات معكوسة</option>
          <option value="cash">نقدي</option>
          <option value="other">أخرى (إلكتروني)</option>
        </select>
        <label className="date-filter">
          <Icon name="calendar" size={17} />
          <span>
            {scopePatient
              ? `إيصالات ${scopePatient.name}`
              : isDoctor
                ? "الأرشيف الكامل"
                : "حدد مريضًا من البحث"}
          </span>
        </label>
      </div>

      {search.length >= 3 && !scopePatient && (
        <div className="data-table" style={{ marginTop: "10px" }}>
          {searchCandidates.map((c) => (
            <button
              key={c.id}
              className="data-row"
              onClick={() => {
                setScopePatient({ id: c.id, name: c.fullName })
                setPage(0)
                setSearch(c.fullName)
              }}
            >
              <strong>{c.fullName}</strong>
              <span>{c.id.slice(-6)}</span>
              <span>{c.lastVisitAt ? "له زيارات سابقة" : "أول زيارة"}</span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
          {searchCandidates.length === 0 && !patientSearchQuery.isFetching && (
            <div className="data-row">
              <span>لا مريض مطابق — تحقق من الاسم.</span>
            </div>
          )}
        </div>
      )}

      {scopePatient && (
        <div className="table-footer" style={{ marginTop: "10px" }}>
          <button
            className="row-action"
            onClick={() => {
              setScopePatient(null)
              setSearch("")
              setPage(0)
            }}
          >
            إلغاء تصفية المريض
          </button>
        </div>
      )}

      <div className="data-table">
        <div className="data-head">
          <span>مرجع الإيصال</span>
          <span>المريض</span>
          <span>التاريخ</span>
          <span>النوع</span>
          <span>المبلغ</span>
          <span>طريقة الدفع</span>
          <span />
        </div>
        {receiptsQuery.isLoading && <SkeletonBlock lines={4} />}
        {receiptsQuery.isError && (
          <div className="data-row">
            <span>تعذر تحميل الإيصالات: {apiErrorMessage(receiptsQuery.error)}</span>
          </div>
        )}
        {!isDoctor && !scopePatient && (
          <div className="data-row">
            <span>ابحث عن مريض بالاسم أعلاه لعرض سجل إيصالاته.</span>
          </div>
        )}
        {isDoctor &&
          !receiptsQuery.isLoading &&
          !receiptsQuery.isError &&
          filtered.length === 0 && (
            <div className="data-row">
              <span>لا توجد إيصالات بعد — تُعرض الإيصالات بعد تسجيلها.</span>
            </div>
          )}
        {filtered.map((r, i) => (
          <ReceiptRow key={r.receiptId} receipt={r} index={i} onOpen={() => setSelected(r)} />
        ))}
      </div>

      <div className="table-footer">
        <span>عرض {arNum(filtered.length)} إيصالًا</span>
        <div>
          <button disabled={page === 0} onClick={() => setPage(0)}>
            البداية
          </button>
          <button
            className={nextCursor ? "active" : ""}
            disabled={!nextCursor || receiptsQuery.isFetching}
            onClick={() => nextCursor && setPage(Number(nextCursor) || 0)}
          >
            {receiptsQuery.isFetching ? "جارٍ التحميل..." : "عرض المزيد"}
          </button>
        </div>
      </div>

      {selected && (
        <ReceiptDetailModal
          receipt={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  )
}

function ReceiptRow({
  receipt,
  index,
  onOpen,
}: {
  receipt: ReceiptDto
  index: number
  onOpen: () => void
}) {
  const patientQuery = useQuery({
    queryKey: ["patient", receipt.patientId],
    queryFn: () => patientsApi.get(receipt.patientId),
    staleTime: 600_000,
  })
  const patientName = patientQuery.data?.fullName ?? receipt.patientId.slice(-6)
  return (
    <button className="data-row" onClick={onOpen}>
      <strong>{receipt.receiptId.slice(-6).toUpperCase()}</strong>
      <span className="patient-cell">
        <span className={`patient-avatar a${index % 4}`}>{patientName.charAt(0)}</span>
        {patientName}
      </span>
      <span>{arDateTimeCompact(receipt.createdAt)}</span>
      <span>{receipt.type === "REVERSAL" ? "عكس" : "تحصيل"}</span>
      <strong>{moneyMinor(receipt.amountMinor)}</strong>
      <span className="method-pill">{methodLabel(receipt.method)}</span>
      <Icon name="chevron" size={16} />
    </button>
  )
}
