/**
 * Centralized UI constants & enum labels — every Arabic string used across the
 * app lives here (translation/constants layer), mapped to the actual backend
 * enums. Preserved design strings stay verbatim from the Figma export.
 */

export type Role = "SECRETARY" | "DOCTOR"

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

export type QueueStatus =
  | "WAITING"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "SKIPPED"
  | "NO_SHOW"
  | "ABANDONED"

export const queueStatusLabel: Record<QueueStatus, string> = {
  WAITING: "في الانتظار",
  IN_CONSULTATION: "مع الطبيب",
  COMPLETED: "مكتمل",
  SKIPPED: "متخطى مؤقتًا",
  NO_SHOW: "لم يحضر",
  ABANDONED: "منقطع",
}

/** Design badge class (waiting / current / done tones). */
export const queueStatusBadge: Record<QueueStatus, string> = {
  WAITING: "waiting",
  IN_CONSULTATION: "current",
  COMPLETED: "done",
  SKIPPED: "waiting",
  NO_SHOW: "waiting",
  ABANDONED: "waiting",
}

export const emergencyReasonLabel: Record<string, string> = {
  DOCTOR_DIRECTED: "توجيه من الطبيب",
  VISIBLE_DISTRESS: "اضطراب ظاهر",
  FAMILY_ESCALATION: "تصعيد من الأسرة",
  PRE_ARRANGED_URGENT: "حالة عاجلة متفق عليها",
  OTHER_URGENT: "سبب عاجل آخر",
}

export const noShowReasonOptions = [
  { value: "LEFT_WITHOUT_NOTICE", label: "غادر دون إخطار" },
  { value: "CALLED_NO_ANSWER", label: "لم يرد على الاتصال" },
  { value: "LATE_ARRIVAL", label: "تأخر عن موعده" },
  { value: "OTHER", label: "سبب آخر" },
]

export const abandonReasonOptions = [
  { value: "LEFT_ANGRY", label: "غادر غاضبًا" },
  { value: "UNREACHABLE", label: "تعذر التواصل" },
  { value: "OTHER", label: "سبب آخر" },
]

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

export type InvoiceStatus =
  | "UNPAID"
  | "PARTIAL"
  | "PAID"
  | "COMPLIMENTARY"
  | "WRITTEN_OFF"

export const invoiceStatusLabel: Record<InvoiceStatus, string> = {
  UNPAID: "غير مدفوعة",
  PARTIAL: "مدفوعة جزئيًا",
  PAID: "مدفوعة",
  COMPLIMENTARY: "استشارة مجانية",
  WRITTEN_OFF: "إسقاط دين",
}

export type PaymentMethodDto = "CASH" | "OTHER"

/** Design payment methods — Vodafone Cash / InstaPay map to backend OTHER. */
export const paymentMethods = [
  { id: "cash", label: "نقدي", icon: "wallet", backend: "CASH" },
  { id: "vodafone", label: "Vodafone Cash", icon: "phone", backend: "OTHER" },
  { id: "instapay", label: "InstaPay", icon: "send", backend: "OTHER" },
] as const

export const methodLabel = (m: string | null | undefined): string =>
  m === "CASH" ? "نقدي" : m === "OTHER" ? "أخرى (إلكتروني)" : "—"

export const pettyDirectionLabel: Record<string, string> = {
  EXPENSE: "مصروف",
  INJECTION: "إيداع",
}

export const shiftResultLabel: Record<string, string> = {
  BALANCED: "متطابقة",
  SURPLUS: "زيادة",
  DEFICIT: "عجز",
}

/* ------------------------------------------------------------------ */
/* Intercom                                                            */
/* ------------------------------------------------------------------ */

export type IntercomType =
  | "DOCTOR_COMPLIMENTARY"
  | "DOCTOR_NEXT"
  | "DOCTOR_FOLLOWUP"
  | "SEC_DISRUPTION"
  | "SEC_PHARMACY_LAB"
  | "SEC_CORRECTION_REQUEST"
  | "CUSTOM_TEXT"

export const intercomTypeLabel: Record<IntercomType, string> = {
  DOCTOR_COMPLIMENTARY: "تحويل لاستشارة مجانية",
  DOCTOR_NEXT: "اطلبي المريض التالي",
  DOCTOR_FOLLOWUP: "حجز موعد متابعة",
  SEC_DISRUPTION: "ضوضاء في صالة الانتظار",
  SEC_PHARMACY_LAB: "اتصال من صيدلية أو معمل",
  SEC_CORRECTION_REQUEST: "تنبيه تشغيلي",
  CUSTOM_TEXT: "رسالة",
}

/** Quick templates — mapped to real backend intercom types. */
export const doctorTemplates = [
  { label: "اطلبي المريض التالي", type: "DOCTOR_NEXT" as IntercomType },
  {
    label: "حوّلي الزيارة لاستشارة مجانية",
    type: "DOCTOR_COMPLIMENTARY" as IntercomType,
  },
  { label: "رتبي موعد متابعة", type: "DOCTOR_FOLLOWUP" as IntercomType },
]

export const secretaryTemplates = [
  { label: "يوجد ضوضاء في صالة الانتظار", type: "SEC_DISRUPTION" as IntercomType },
  {
    label: "هناك اتصال من صيدلية",
    type: "SEC_PHARMACY_LAB" as IntercomType,
  },
  {
    label: "مطلوب تنبيه تشغيلي",
    type: "CUSTOM_TEXT" as IntercomType,
  },
]

export const followUpStatusLabel: Record<string, string> = {
  REQUESTED: "مطلوب",
  SCHEDULED: "مجدول",
  DONE: "منتهي",
  CANCELLED: "ملغي",
}

/* ------------------------------------------------------------------ */
/* EHR / medications                                                   */
/* ------------------------------------------------------------------ */

export const cessationReasonOptions = [
  { value: "RESOLVED", label: "تحسن / انتهاء الحالة" },
  { value: "SIDE_EFFECTS", label: "آثار جانبية" },
  { value: "INEFFECTIVE", label: "عدم الاستجابة" },
  { value: "NON_ADHERENCE", label: "عدم الالتزام بالجرعة" },
  { value: "DOSE_ADJUSTED", label: "تعديل الجرعة" },
  { value: "CONTRAINDICATED", label: "مانع استعمال" },
  { value: "OTHER", label: "سبب آخر" },
]

export const addendumReasonOptions = [
  { value: "CORRECTION", label: "تصحيح" },
  { value: "CLARIFICATION", label: "توضيح" },
  { value: "NEW_INFORMATION", label: "معلومات جديدة" },
  { value: "OTHER", label: "أخرى" },
]

export const encounterStatusLabel: Record<string, string> = {
  DRAFT: "مسودة",
  SIGNED: "معتمد",
  DISCARDED: "مهمل",
}

/** MSE quick-select options — preserved from the Figma design. */
export const mseOptions = {
  appearance: ["مهندم", "عناية متوسطة", "غير معتنى"],
  behavior: ["متعاون", "قلق", "متحفظ"],
  speechCoherence: ["مترابط", "متسارع", "متقطع"],
  moodAffect: ["مستقر", "قلق", "مكتئب", "مبتهج"],
} as const

export const mseFieldLabel: Record<string, string> = {
  appearance: "المظهر",
  behavior: "السلوك",
  speechCoherence: "ترابط الكلام",
  moodAffect: "المزاج والانفعال",
}

/* ------------------------------------------------------------------ */
/* Page titles & navigation                                            */
/* ------------------------------------------------------------------ */

export const routeTitle: Record<string, string> = {
  "/secretary": "نظرة اليوم",
  "/secretary/checkin": "تسجيل حضور مريض",
  "/secretary/payments": "المدفوعات والرصيد",
  "/secretary/receipts": "أرشيف الإيصالات",
  "/secretary/closing": "الإغلاق والتقرير اليومي",
  "/secretary/patients": "ملفات المرضى",
  "/chat": "التواصل الداخلي",
  "/doctor": "لوحة الطبيب",
  "/doctor/patients": "ملفات المرضى",
  "/doctor/session": "مساحة الجلسة",
  "/doctor/soap": "تقارير SOAP",
  "/doctor/medications": "الأدوية والسلامة",
  "/doctor/settings": "الإعدادات والمستخدمون",
  "/doctor/reports": "التقارير الإشرافية",
  "/display": "شاشة الانتظار",
}
