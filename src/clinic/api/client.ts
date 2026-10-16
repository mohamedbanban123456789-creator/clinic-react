/**
 * Centralized API client — the ONLY place that talks HTTP to the backend.
 *
 * - Access JWT lives in memory only (never localStorage; the refresh cookie
 *   is scoped to /clinic-api/v1/auth and restores the session on reload).
 * - Every 401 triggers one silent refresh + retry.
 * - 403 PASSWORD_CHANGE_REQUIRED routes the user to the password screen.
 * - Idempotency-Key (uuid v4) is generated for cash-critical mutations.
 * - Errors are normalized to ApiError { code, message, details, status }.
 */

const BASE = "/clinic-api/v1"

export class ApiError extends Error {
  readonly code: string
  readonly details: { field?: string; issue: string; expected?: string }[]
  readonly status: number

  constructor(
    status: number,
    code: string,
    message: string,
    details: ApiError["details"] = [],
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }
}

let accessToken: string | null = null
let userId: string | null = null
let role: "DOCTOR" | "SECRETARY" | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export function setSessionIdentity(
  id: string | null,
  userRole: "DOCTOR" | "SECRETARY" | null,
): void {
  userId = id
  role = userRole
}

export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }
  // Fallback for older browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === "x" ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/* ------------------------------------------------------------------ */
/* Auth events — consumed by AuthContext / socket layer                */
/* ------------------------------------------------------------------ */

type AuthListener = (reason: "expired" | "revoked" | "password-change") => void
const authListeners = new Set<AuthListener>()

export function onAuthEvent(listener: AuthListener): () => void {
  authListeners.add(listener)
  return () => authListeners.delete(listener)
}

function emitAuthEvent(reason: "expired" | "revoked" | "password-change"): void {
  authListeners.forEach((l) => l(reason))
}

/* ------------------------------------------------------------------ */
/* Refresh flow                                                        */
/* ------------------------------------------------------------------ */

let refreshInFlight: Promise<boolean> | null = null

export async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        credentials: "include",
      })
      if (!res.ok) return false
      const body = (await res.json()) as { accessToken?: string }
      if (typeof body.accessToken !== "string") return false
      accessToken = body.accessToken
      return true
    } catch {
      return false
    } finally {
      refreshInFlight = null
    }
  })()
  return refreshInFlight
}

/* ------------------------------------------------------------------ */
/* Core request helper                                                 */
/* ------------------------------------------------------------------ */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  idempotency?: boolean
  ifMatch?: number
  /** Skip the automatic refresh retry (used by the refresh call itself). */
  skipRefresh?: boolean
  signal?: AbortSignal
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
    details?: { field?: string; issue: string; expected?: string }[]
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value))
      }
    }
  }

  if (path.startsWith("/supervision") && role === "SECRETARY") {
    throw new ApiError(403, "FORBIDDEN", "غير مصرح لحساب الاستقبال بالوصول للتقارير الإشرافية")
  }

  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers["Content-Type"] = "application/json"
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`
  if (options.idempotency) headers["Idempotency-Key"] = newIdempotencyKey()
  if (options.ifMatch !== undefined) headers["If-Match"] = String(options.ifMatch)

  const doFetch = (): Promise<Response> =>
    fetch(url.toString(), {
      method: options.method ?? "GET",
      headers,
      credentials: "include",
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    })

  let res: Response
  try {
    res = await doFetch()
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err
    throw new ApiError(0, "NETWORK", "تعذر الوصول إلى الخادم، تحقق من الاتصال")
  }

  // Silent refresh + single retry on 401.
  if (res.status === 401 && !options.skipRefresh) {
    const refreshed = await tryRefresh()
    if (refreshed) {
      headers.Authorization = `Bearer ${accessToken}`
      res = await doFetch()
    } else {
      accessToken = null
      emitAuthEvent("expired")
      throw new ApiError(401, "UNAUTHORIZED", "انتهت الجلسة، يرجى تسجيل الدخول")
    }
  }

  if (res.status === 403) {
    const body = (await safeJson(res)) as ErrorEnvelope
    const code = body.error?.code ?? "FORBIDDEN"
    if (code === "PASSWORD_CHANGE_REQUIRED") {
      emitAuthEvent("password-change")
      throw new ApiError(403, code, "يجب تغيير كلمة المرور أولًا")
    }
    if (code === "ACCOUNT_DEACTIVATED") emitAuthEvent("revoked")
  }

  if (!res.ok) {
    const body = (await safeJson(res)) as ErrorEnvelope
    throw new ApiError(
      res.status,
      body.error?.code ?? `HTTP_${res.status}`,
      body.error?.message ?? `فشل الطلب (${res.status})`,
      body.error?.details ?? [],
    )
  }

  if (res.status === 204) return undefined as T
  return (await safeJson(res)) as T
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

/** Human-readable Arabic message for known backend error codes. */
export function apiErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const map: Record<string, string> = {
      UNAUTHORIZED: "انتهت الجلسة أو البيانات غير صحيحة",
      FORBIDDEN: "لا تملك صلاحية تنفيذ هذا الإجراء",
      NO_OPEN_SHIFT: "لا توجد وردية مفتوحة — افتح الوردية أولًا من شاشة الإغلاق اليومي",
      SHIFT_ALREADY_OPEN: "توجد وردية مفتوحة بالفعل",
      ALREADY_ACTIVE: "المريض مسجل بالفعل في طابور اليوم",
      STALE_QUEUE: "تغير ترتيب الطابور منذ قليل — سيتم التحديث، حاول مرة أخرى",
      POSSIBLE_DUPLICATE: "يوجد مريض مشابه — راجع بياناته قبل التأكيد",
      FLOOR_VIOLATION:
        "الخصم يتجاوز الحد المسموح للاستقبال (يتطلب موافقة الطبيب)",
      OVERPAYMENT_REJECTED: "المبلغ المدفوع يتجاوز قيمة الفاتورة",
      SHIFT_LOCKED: "الوردية مقفلة — لا يمكن تعديل بياناتها",
      GEMINI_KEY_MISSING: "خدمة معالجة الصوت غير مفعلة على الخادم (مفتاح AI غير مكون)",
      GEMINI_TIMEOUT: "انتهت مهلة معالجة الصوت، حاول مرة أخرى",
      GROQ_KEY_MISSING: "خدمة معالجة الصوت غير مفعلة على الخادم (مفتاح AI غير مكون)",
      GROQ_TIMEOUT: "انتهت مهلة معالجة الصوت، حاول مرة أخرى",
      GROQ_UPSTREAM: "تعذر الوصول إلى خدمة المعالجة — حاول مرة أخرى",
      IDEMPOTENCY_KEY_CONFLICT: "تعارض في الطلب، حدّث الصفحة وحاول مجددًا",
      STALE_ROW_VERSION: "تم تعديل التقرير من جهة أخرى — أعد التحميل",
      ALREADY_SIGNED: "التقرير معتمد بالفعل ولا يمكن تعديله",
      TOO_MANY_ATTEMPTS: "محاولات كثيرة — انتظر ١٥ دقيقة ثم أعد المحاولة",
      NETWORK: "تعذر الوصول إلى الخادم، تحقق من الاتصال",
      UNDO_WINDOW_EXPIRED: "انتهت مهمة التراجع (١٥ دقيقة)",
      UNDO_BLOCKED: "لا يمكن التراجع بعد اعتماد السجل أو التحصيل",
      ACTIVE_CONSULTATION_EXISTS: "توجد جلسة جارية — أنهها أولًا أو استخدم الاستدعاء القسري",
      CONSENT_REQUIRED: "يجب تأكيد موافقة المريض على التسجيل أولًا",
    }
    if (map[err.code]) return map[err.code]
    if (err.message && err.message !== `HTTP_${err.status}`) return err.message
    return `فشل الطلب (${err.status})`
  }
  if (err instanceof Error && err.name === "AbortError") return "أُلغي الطلب"
  return "حدث خطأ غير متوقع"
}
