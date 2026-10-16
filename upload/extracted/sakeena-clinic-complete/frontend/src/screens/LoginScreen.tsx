/**
 * Login screen — visual design preserved exactly from the Figma export.
 * Real authentication: POST /auth/login, error box driven by backend errors,
 * no mock "first submit always fails" quirk.
 */

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/auth/AuthContext"
import { apiErrorMessage, ApiError } from "@/api/client"
import { AppButton, Icon, useToast } from "@/components/ui"

export default function LoginScreen() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const { notify } = useToast()
  const [identifier, setIdentifier] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    if (!identifier.trim() || !password) {
      setError("يرجى إدخال اسم المستخدم وكلمة المرور.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const me = await login(identifier, password)
      notify(`مرحبًا ${me.name}`)
      if (me.passwordMustChange) {
        navigate("/change-password", { replace: true })
      } else {
        navigate(me.role === "DOCTOR" ? "/doctor" : "/secretary", { replace: true })
      }
    } catch (err) {
      const message =
        err instanceof ApiError && err.code === "TOO_MANY_ATTEMPTS"
          ? "محاولات كثيرة خاطئة — انتظر ١٥ دقيقة ثم أعد المحاولة."
          : "راجع بيانات الدخول وحاول مرة أخرى."
      setError(message)
      void apiErrorMessage(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page" dir="rtl">
      <div className="login-visual">
        <div className="login-brand">
          <div className="brand-mark">
            <Icon name="heart" />
          </div>
          <span>
            <strong>سكينة</strong>
            <small>لإدارة العيادات النفسية</small>
          </span>
        </div>
        <div className="login-quote">
          <div className="quote-art">
            <span />
            <span />
            <Icon name="heart" size={48} />
          </div>
          <span className="eyebrow light">رعاية أهدأ، عمل أوضح</span>
          <h1>
            كل تفاصيل يوم العيادة،
            <br />
            في مساحة واحدة آمنة.
          </h1>
          <p>من لحظة وصول المريض وحتى اكتمال التوثيق السريري وإغلاق الخزينة.</p>
        </div>
        <small className="copyright">
          © ٢٠٢٦ نظام سكينة · استخدام داخلي للعيادة
        </small>
      </div>
      <div className="login-form-wrap">
        <form className="login-card" onSubmit={submit}>
          <div className="mobile-brand">
            <div className="brand-mark">
              <Icon name="heart" />
            </div>
            <strong>سكينة</strong>
          </div>
          <span className="section-kicker">مرحبًا بعودتك</span>
          <h2>تسجيل دخول فريق العيادة</h2>
          <p>أدخل بيانات حسابك للوصول إلى مساحة العمل.</p>
          {error && (
            <div className="login-error">
              <Icon name="alert" />
              <span>
                <strong>تعذر تسجيل الدخول</strong>
                <small>{error}</small>
              </span>
            </div>
          )}
          <label className="field">
            <span>البريد الإلكتروني أو اسم المستخدم</span>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="مثال: doctor أو sara"
              autoFocus
              autoComplete="username"
            />
          </label>
          <label className="field password-field">
            <span>كلمة المرور</span>
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label="إظهار كلمة المرور">
              <Icon name="eye" />
            </button>
          </label>
          <label className="remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />{" "}
            تذكرني على هذا الجهاز
          </label>
          <AppButton className="full" type="submit" disabled={busy}>
            {busy ? "جارٍ التحقق..." : "تسجيل الدخول"}
          </AppButton>
          <div className="login-security">
            <Icon name="lock" />
            <span>
              <strong>اتصال آمن ومشفّر</strong>
              <small>هذه المنصة مخصصة لفريق العيادة فقط.</small>
            </span>
          </div>
        </form>
      </div>
    </div>
  )
}
