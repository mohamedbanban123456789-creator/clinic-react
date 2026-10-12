/**
 * Forced password change — shown after first login (or whenever the backend
 * flags passwordMustChange / PASSWORD_CHANGE_REQUIRED). Built with the same
 * visual language as the login card. After success the user re-logs in.
 */

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@/auth/AuthContext"
import { apiErrorMessage, ApiError } from "@/api/client"
import { AppButton, Icon, useToast } from "@/components/ui"

export default function ChangePasswordScreen() {
  const { user, changePassword, logout } = useAuth()
  const navigate = useNavigate()
  const { notify } = useToast()
  const [oldPassword, setOld] = useState("")
  const [newPassword, setNew] = useState("")
  const [confirmPassword, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (newPassword.length < 8) {
      setError("كلمة المرور الجديدة يجب أن تكون ٨ أحرف على الأقل.")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("تأكيد كلمة المرور غير مطابق.")
      return
    }
    setBusy(true)
    try {
      await changePassword(oldPassword, newPassword)
      notify("تم تغيير كلمة المرور — سجّل الدخول من جديد")
      navigate("/login", { replace: true })
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 401
          ? "كلمة المرور الحالية غير صحيحة."
          : apiErrorMessage(err)
      setError(message)
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
            <Icon name="lock" size={48} />
          </div>
          <span className="eyebrow light">خطوة أمان أولى</span>
          <h1>
            أمان حسابك أولًا،
            <br />
            ثم تبدأ يوم العمل.
          </h1>
          <p>تُطلب هذه الخطوة مرة واحدة عند أول دخول أو بعد إعادة تعيين كلمة المرور.</p>
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
          <span className="section-kicker">{user?.name ?? ""}</span>
          <h2>تغيير كلمة المرور</h2>
          <p>اختر كلمة مرور جديدة قوية للمتابعة إلى مساحة العمل.</p>
          {error && (
            <div className="login-error">
              <Icon name="alert" />
              <span>
                <strong>تعذر إكمال الخطوة</strong>
                <small>{error}</small>
              </span>
            </div>
          )}
          <label className="field">
            <span>كلمة المرور الحالية</span>
            <input
              type="password"
              value={oldPassword}
              onChange={(e) => setOld(e.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span>كلمة المرور الجديدة (٨ أحرف على الأقل)</span>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <label className="field">
            <span>تأكيد كلمة المرور الجديدة</span>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </label>
          <AppButton className="full" type="submit" disabled={busy}>
            {busy ? "جارٍ الحفظ..." : "حفظ كلمة المرور الجديدة"}
          </AppButton>
          <button
            type="button"
            className="text-link"
            onClick={() => void logout().then(() => navigate("/login", { replace: true }))}
          >
            تسجيل الخروج بدلًا من ذلك
          </button>
          <div className="login-security">
            <Icon name="lock" />
            <span>
              <strong>تُبطل كلمة المرور الجديدة كل الجلسات المفتوحة</strong>
              <small>ستحتاج لتسجيل الدخول مرة أخرى بعد الحفظ.</small>
            </span>
          </div>
        </form>
      </div>
    </div>
  )
}
