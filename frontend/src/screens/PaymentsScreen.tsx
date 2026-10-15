/**
 * Payments screen — design preserved. Real flows:
 *  - Select a completed visit (invoice created automatically on completion)
 *    or arrive via ?entry= / ?patient=.
 *  - Checkout: POST /billing/checkout with Idempotency-Key, secretary
 *    discount-floor enforcement (FLOOR_VIOLATION surfaced in Arabic).
 *  - Previous debt: GET /patients/:id/balance + POST /patients/:id/settle.
 *  - Receipt modal rendered from the real CheckoutDto.
 */

import { useEffect, useMemo, useState } from "react"
import { useNavigate, useParams, useSearchParams } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { billingApi } from "@/api/billing"
import { patientsApi } from "@/api/patients"
import { queueApi } from "@/api/queue"
import { settingsApi } from "@/api/admin"
import { shiftsApi } from "@/api/shifts"
import { useShiftInvoices } from "@/hooks/useShiftInvoices"
import { apiErrorMessage, ApiError } from "@/api/client"
import { AppButton, Icon, Modal, useToast, ConfirmModal } from "@/components/ui"
import { arNum, arDate, moneyMinor, minorToMajor } from "@/lib/format"
import { paymentMethods } from "@/lib/constants"
import type { CheckoutDto, InvoiceListItemDto, PatientDto } from "@/api/types"
import { useAuth } from "@/auth/AuthContext"

function ReceiptModal({
  checkout,
  patient,
  onClose,
}: {
  checkout: CheckoutDto
  patient: PatientDto | null
  onClose: () => void
}) {
  const paidFull = checkout.outstandingMinor === 0
  return (
    <Modal
      title="تفاصيل الإيصال"
      subtitle={`مرجع ${checkout.receiptId?.slice(-6).toUpperCase() ?? ""}`}
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
            {paidFull ? "مدفوع" : "مدفوع جزئيًا"}
          </span>
        </div>
        <div className="receipt-info">
          <span>
            <small>المريض</small>
            <strong>{patient?.fullName ?? checkout.patientId.slice(-6)}</strong>
          </span>
          <span>
            <small>رقم الملف</small>
            <strong>{checkout.patientId.slice(-6)}</strong>
          </span>
          <span>
            <small>التاريخ</small>
            <strong>{arDate(checkout.createdAt)}</strong>
          </span>
        </div>
        <div className="receipt-lines">
          <span>
            <b>رسوم الزيارة</b>
            <b>{moneyMinor(checkout.finalFeeMinor + checkout.discountMinor)}</b>
          </span>
          {checkout.discountMinor > 0 && (
            <span>
              <i>خصم — {checkout.discountReason ?? ""}</i>
              <i>- {moneyMinor(checkout.discountMinor)}</i>
            </span>
          )}
          <span className="receipt-total">
            <b>الإجمالي المستحق</b>
            <b>{moneyMinor(checkout.finalFeeMinor)}</b>
          </span>
          <span>
            <i>المدفوع ({checkout.method === "CASH" ? "نقدي" : "أخرى"})</i>
            <i>{moneyMinor(checkout.collectedMinor)}</i>
          </span>
          {!paidFull && (
            <span className="receipt-due">
              <b>الرصيد المتبقي</b>
              <b>{moneyMinor(checkout.outstandingMinor)}</b>
            </span>
          )}
        </div>
        <p className="receipt-footnote">
          تم إصدار هذا الإيصال إلكترونيًا بواسطة نظام سكينة. سيظهر الرصيد المتبقي
          تلقائيًا عند الزيارة القادمة.
        </p>
      </div>
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

export default function PaymentsScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"

  const entryParam = params.get("entry")
  const patientParam = params.get("patient")

  const shiftQuery = useQuery({
    queryKey: ["shifts", "current"],
    queryFn: () => shiftsApi.current(),
  })
  const shiftId = shiftQuery.data?.status === "OPEN" ? shiftQuery.data.shiftId : undefined

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
    staleTime: 300_000,
  })

  const queueQuery = useQuery({
    queryKey: ["queue", "current"],
    queryFn: () => queueApi.list(),
  })

  // Role-aware invoice list (secretary uses patient-scoped reads per DB-10).
  const openInvoicesQuery = useShiftInvoices(shiftId)

  const entryFromParam = entryParam
    ? queueQuery.data?.entries.find((e) => e.entryId === entryParam)
    : undefined

  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceListItemDto | null>(null)
  const [fee, setFee] = useState(0)
  const [discount, setDiscount] = useState(0)
  const [discountReason, setDiscountReason] = useState("")
  const [paid, setPaid] = useState(0)
  const [method, setMethod] = useState<string>("cash")
  const [receipt, setReceipt] = useState<CheckoutDto | null>(null)
  const [showSettle, setShowSettle] = useState(false)
  const [settleAmount, setSettleAmount] = useState(0)

  useEffect(() => {
    const standard = minorToMajor(settingsQuery.data?.standardFeeMinor ?? 0)
    if (standard > 0 && fee === 0) setFee(standard)
  }, [settingsQuery.data, fee])

  // Adopt the invoice for ?entry= / ?patient= on load.
  useEffect(() => {
    if (selectedInvoice || !openInvoicesQuery.invoices) return
    const invoices = openInvoicesQuery.invoices
    let target: InvoiceListItemDto | undefined
    if (entryFromParam) {
      target = invoices.find((inv) => inv.queueEntryId === entryFromParam.entryId)
    }
    if (!target && patientParam) {
      target = invoices.find((inv) => inv.patientId === patientParam)
    }
    if (target) setSelectedInvoice(target)
  }, [openInvoicesQuery.invoices, entryFromParam, patientParam, selectedInvoice])

  useEffect(() => {
    if (selectedInvoice) {
      setFee(minorToMajor(selectedInvoice.standardFeeMinor))
      setDiscount(minorToMajor(selectedInvoice.discountMinor))
      setDiscountReason(selectedInvoice.discountReason ?? "")
      setPaid(minorToMajor(Math.min(selectedInvoice.collectedMinor, selectedInvoice.finalFeeMinor)))
    }
  }, [selectedInvoice])

  const patientQuery = useQuery({
    queryKey: ["patient", selectedInvoice?.patientId],
    queryFn: () => patientsApi.get(selectedInvoice!.patientId),
    enabled: Boolean(selectedInvoice),
  })

  const balanceQuery = useQuery({
    queryKey: ["patient-balance", selectedInvoice?.patientId],
    queryFn: () => patientsApi.balance(selectedInvoice!.patientId),
    enabled: Boolean(selectedInvoice),
  })

  const checkoutMutation = useMutation({
    mutationFn: () => {
      if (!selectedInvoice) throw new Error("لم يتم اختيار زيارة")
      return billingApi.checkout({
        queueEntryId: selectedInvoice.queueEntryId,
        collectedMinor: Math.round(paid * 100),
        finalFeeMinor: Math.round((fee - discount) * 100),
        ...(discount > 0 ? { discountReason: discountReason.trim() } : {}),
        method: paymentMethods.find((m) => m.id === method)?.backend ?? "CASH",
      })
    },
    onSuccess: (checkout) => {
      setReceipt(checkout)
      notify("تم تسجيل الدفعة وإنشاء الإيصال")
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
      void queryClient.invalidateQueries({ queryKey: ["queue"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const settleMutation = useMutation({
    mutationFn: (amountMajor: number) =>
      patientsApi.settle(
        selectedInvoice!.patientId,
        Math.round(amountMajor * 100),
        paymentMethods.find((m) => m.id === method)?.backend ?? "CASH",
      ),
    onSuccess: (res) => {
      notify(`تم تحصيل ${moneyMinor(res.appliedMinor)} من الرصيد السابق`)
      setShowSettle(false)
      void queryClient.invalidateQueries({ queryKey: ["patient-balance"] })
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const total = Math.max(0, fee - discount)
  const remaining = Math.max(0, total - paid)
  const standard = minorToMajor(settingsQuery.data?.standardFeeMinor ?? 0)
  const discountReasonRequired = discount > 0 && discountReason.trim().length < 10
  const outstanding = balanceQuery.data?.outstandingMinor ?? 0

  const selectableInvoices = useMemo(
    () =>
      (openInvoicesQuery.invoices ?? []).filter(
        (inv) => inv.status === "UNPAID" || inv.status === "PARTIAL",
      ),
    [openInvoicesQuery.invoices],
  )

  if (!shiftId) {
    return (
      <section className="card form-card">
        <div className="step-header">
          <span className="step-no">!</span>
          <div>
            <h2>لا توجد وردية مفتوحة</h2>
            <p>يتعذر التحصيل قبل فتح الوردية — افتحها من شاشة الإغلاق اليومي.</p>
          </div>
        </div>
        <AppButton icon="chart" onClick={() => navigate("/secretary/closing")}>
          الانتقال إلى الإغلاق اليومي
        </AppButton>
      </section>
    )
  }

  return (
    <div className="payment-layout">
      <section className="card billing-form">
        <div className="card-header">
          <div>
            <span className="section-kicker">
              زيارة #{selectedInvoice ? selectedInvoice.queueEntryId.slice(-6) : "—"}
            </span>
            <h2>تحصيل رسوم الزيارة</h2>
            <p>راجع تفاصيل الزيارة وسجّل طريقة الدفع.</p>
          </div>
          <div className="patient-chip">
            <span className="patient-avatar">
              {(patientQuery.data?.fullName ?? "؟").charAt(0)}
            </span>
            <span>
              <strong>{patientQuery.data?.fullName ?? "اختر زيارة"}</strong>
              <small>{selectedInvoice?.patientId.slice(-6) ?? "—"}</small>
            </span>
          </div>
        </div>

        {!selectedInvoice && (
          <div className="form-section">
            <h3>زيارات بانتظار التحصيل</h3>
            {selectableInvoices.length === 0 && (
              <p>لا توجد فواتير غير مدفوعة في هذه الوردية.</p>
            )}
            <div className="data-table">
              {selectableInvoices.map((inv) => (
                <button
                  key={inv.invoiceId}
                  className="data-row"
                  onClick={() => setSelectedInvoice(inv)}
                >
                  <strong>{inv.patientId.slice(-6)}</strong>
                  <span>{moneyMinor(inv.finalFeeMinor)}</span>
                  <span className="due-text">{moneyMinor(inv.outstandingMinor)}</span>
                  <Icon name="chevron" size={16} />
                </button>
              ))}
            </div>
          </div>
        )}

        {selectedInvoice && outstanding > 0 && (
          <div className="outstanding-banner">
            <Icon name="alert" />
            <div>
              <strong>يوجد رصيد سابق بقيمة {moneyMinor(outstanding)}</strong>
              <p>
                يمكن تحصيله مع هذه الزيارة أو الإبقاء عليه كتذكير للزيارة القادمة.
              </p>
            </div>
            <AppButton variant="outline" onClick={() => setShowSettle(true)}>
              إضافة للتحصيل
            </AppButton>
          </div>
        )}

        {selectedInvoice && (
          <>
            <div className="form-section">
              <h3>تفاصيل الرسوم</h3>
              <div className="form-row thirds">
                <label className="field">
                  <span>نوع الزيارة</span>
                  <select defaultValue="visit">
                    <option value="visit">زيارة في الوردية الحالية</option>
                  </select>
                </label>
                <label className="field money-field">
                  <span>السعر المقترح {`(${arNum(standard)} ج.م. أساسي)`}</span>
                  <input
                    type="number"
                    value={fee}
                    onChange={(e) => setFee(Number(e.target.value))}
                  />
                  <i>ج.م.</i>
                </label>
                <label className="field money-field">
                  <span>الخصم</span>
                  <input
                    type="number"
                    value={discount}
                    onChange={(e) => setDiscount(Number(e.target.value))}
                  />
                  <i>ج.م.</i>
                </label>
              </div>
              {discount > 0 && (
                <label className="field">
                  <span>
                    سبب الخصم <b>*</b>
                  </span>
                  <input
                    value={discountReason}
                    onChange={(e) => setDiscountReason(e.target.value)}
                    placeholder="مثال: خصم متابعة متقاربة خلال أسبوعين"
                  />
                  <small>مطلوب عند تخفيض قيمة الكشف الافتراضية (١٠ أحرف على الأقل).</small>
                </label>
              )}
            </div>
            <div className="form-section">
              <h3>طريقة الدفع</h3>
              <div className="payment-methods">
                {paymentMethods.map((m) => (
                  <button
                    key={m.id}
                    className={method === m.id ? "payment-method selected" : "payment-method"}
                    onClick={() => setMethod(m.id)}
                    type="button"
                  >
                    <span>
                      <Icon name={m.icon} />
                    </span>
                    <strong>{m.label}</strong>
                    {method === m.id && (
                      <i>
                        <Icon name="check" size={13} />
                      </i>
                    )}
                  </button>
                ))}
              </div>
              <label className="field money-field paid-input">
                <span>المبلغ المدفوع</span>
                <input
                  type="number"
                  value={paid}
                  onChange={(e) => setPaid(Number(e.target.value))}
                />
                <i>ج.م.</i>
              </label>
            </div>
          </>
        )}
      </section>
      <aside className="card invoice-summary">
        <span className="section-kicker">ملخص الحساب</span>
        <h3>قيمة الزيارة</h3>
        {selectedInvoice ? (
          <>
            <div className="invoice-lines">
              <span>
                رسوم الزيارة <b>{moneyMinor(Math.round(fee * 100))}</b>
              </span>
              <span className="discount-line">
                الخصم <b>- {moneyMinor(Math.round(discount * 100))}</b>
              </span>
              <span className="total-line">
                المبلغ النهائي <b>{moneyMinor(Math.round(total * 100))}</b>
              </span>
              <span>
                المدفوع الآن <b>{moneyMinor(Math.round(paid * 100))}</b>
              </span>
            </div>
            <div
              className={remaining > 0 ? "remaining-box" : "remaining-box settled"}
            >
              <span>{remaining > 0 ? "الرصيد المتبقي" : "تم السداد بالكامل"}</span>
              <strong>{moneyMinor(Math.round(remaining * 100))}</strong>
              <small>
                {remaining > 0
                  ? "سيظهر كتذكير في الزيارة القادمة"
                  : "لا توجد مبالغ مستحقة لهذه الزيارة"}
              </small>
            </div>
            <AppButton
              icon="receipt"
              onClick={() => checkoutMutation.mutate()}
              disabled={
                checkoutMutation.isPending ||
                discountReasonRequired ||
                paid < 0 ||
                paid > total
              }
            >
              {checkoutMutation.isPending ? "جارٍ التسجيل..." : "تأكيد الدفع وإصدار إيصال"}
            </AppButton>
            <p className="safe-note">
              <Icon name="lock" size={14} /> سيتم حفظ العملية في سجل الخزينة اليومي.
            </p>
          </>
        ) : (
          <div className="empty-state">
            <Icon name="wallet" size={34} />
            <h3>اختر زيارة للتحصيل</h3>
            <p>تُنشأ الفاتورة تلقائيًا عند اكتمال الزيارة من مساحة الطبيب.</p>
          </div>
        )}
      </aside>

      {receipt && (
        <ReceiptModal
          checkout={receipt}
          patient={patientQuery.data ?? null}
          onClose={() => setReceipt(null)}
        />
      )}

      {showSettle && selectedInvoice && (
        <Modal
          title="تحصيل رصيد سابق"
          subtitle={`الرصيد المستحق: ${moneyMinor(outstanding)}`}
          onClose={() => setShowSettle(false)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (settleAmount > 0) settleMutation.mutate(settleAmount)
            }}
          >
            <label className="field money-field">
              <span>المبلغ المُحصّل من الرصيد السابق</span>
              <input
                type="number"
                value={settleAmount || ""}
                onChange={(e) => setSettleAmount(Number(e.target.value))}
                placeholder={`حتى ${arNum(minorToMajor(outstanding))}`}
              />
              <i>ج.م.</i>
            </label>
            <div className="modal-actions">
              <AppButton variant="outline" type="button" onClick={() => setShowSettle(false)}>
                إلغاء
              </AppButton>
              <AppButton
                type="submit"
                icon="wallet"
                disabled={settleMutation.isPending || settleAmount <= 0}
              >
                {settleMutation.isPending ? "جارٍ التحصيل..." : "تحصيل الرصيد"}
              </AppButton>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
