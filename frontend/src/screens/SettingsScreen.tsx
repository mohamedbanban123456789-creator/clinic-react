/**
 * Settings screen (doctor only) — new screen in the established design
 * language: clinic financial settings (PUT /settings) and staff management
 * (create secretary, activate/deactivate, temporary password reset).
 */

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { settingsApi, usersApi } from "@/api/admin"
import { apiErrorMessage } from "@/api/client"
import { AppButton, Icon, Modal, useToast, SkeletonBlock } from "@/components/ui"
import { arNum } from "@/lib/format"

export default function SettingsScreen() {
  const { notify } = useToast()
  const queryClient = useQueryClient()

  const settingsQuery = useQuery({
    queryKey: ["settings"],
    queryFn: () => settingsApi.get(),
  })
  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list(),
  })

  const [form, setForm] = useState({
    standardFee: 0,
    currency: "EGP",
    avgConsultDurationMin: 20,
    secretaryMaxDiscount: 0,
    secretaryMaxDiscountPct: 10,
    openingFloat: 0,
    audioRetentionDays: 30,
  })

  useEffect(() => {
    const s = settingsQuery.data
    if (s) {
      setForm({
        standardFee: s.standardFeeMinor / 100,
        currency: s.currency,
        avgConsultDurationMin: s.avgConsultDurationMin,
        secretaryMaxDiscount: s.secretaryMaxDiscountMinor / 100,
        secretaryMaxDiscountPct: s.secretaryMaxDiscountPct,
        openingFloat: s.openingFloatMinor / 100,
        audioRetentionDays: s.audioRetentionDays,
      })
    }
  }, [settingsQuery.data])

  const saveMutation = useMutation({
    mutationFn: () =>
      settingsApi.update({
        standardFeeMinor: Math.round(form.standardFee * 100),
        currency: form.currency.trim().toUpperCase(),
        avgConsultDurationMin: Math.round(form.avgConsultDurationMin),
        secretaryMaxDiscountMinor: Math.round(form.secretaryMaxDiscount * 100),
        secretaryMaxDiscountPct: Math.round(form.secretaryMaxDiscountPct),
        openingFloatMinor: Math.round(form.openingFloat * 100),
        audioRetentionDays: Math.round(form.audioRetentionDays),
      }),
    onSuccess: () => {
      notify("حُفظت إعدادات العيادة")
      void queryClient.invalidateQueries({ queryKey: ["settings"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState<{
    name: string
    identifier: string
    password: string
    gender: "MALE" | "FEMALE" | null
  }>({ name: "", identifier: "", password: "", gender: null })
  const [tempPassword, setTempPassword] = useState<{ name: string; password: string } | null>(null)

  const createMutation = useMutation({
    mutationFn: () => {
      if (!createForm.gender) throw new Error("يجب تحديد الجنس")
      return usersApi.createSecretary({
        name: createForm.name.trim(),
        identifier: createForm.identifier.trim(),
        password: createForm.password,
        gender: createForm.gender,
      })
    },
    onSuccess: (user) => {
      notify(`أُنشئ حساب ${user.name} — سيتغير لكلمة المرور عند أول دخول`)
      setShowCreate(false)
      setCreateForm({ name: "", identifier: "", password: "", gender: null })
      void queryClient.invalidateQueries({ queryKey: ["users"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const toggleMutation = useMutation({
    mutationFn: (args: { id: string; activate: boolean }) =>
      args.activate ? usersApi.activate(args.id) : usersApi.deactivate(args.id),
    onSuccess: (res) => {
      notify(res.isActive ? "فُعّل الحساب" : "عُطّل الحساب وجُمّدت جلساته")
      void queryClient.invalidateQueries({ queryKey: ["users"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const resetMutation = useMutation({
    mutationFn: (id: string) => usersApi.resetPassword(id),
    onSuccess: (res, id) => {
      const user = (usersQuery.data?.data ?? []).find((u) => u.id === id)
      setTempPassword({ name: user?.name ?? id.slice(-6), password: res.temporaryPassword })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const users = usersQuery.data?.data ?? []

  return (
    <>
      <section className="card form-card" style={{ marginBottom: "16px" }}>
        <div className="card-header">
          <div>
            <span className="section-kicker">إعدادات العيادة</span>
            <h2>الرسوم والعمليات</h2>
            <p>تُطبق هذه القيم على الفواتير والطابور الجديد.</p>
          </div>
        </div>
        {settingsQuery.isLoading ? (
          <SkeletonBlock lines={4} />
        ) : (
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              saveMutation.mutate()
            }}
          >
            <div className="form-row thirds">
              <label className="field money-field">
                <span>رسوم الزيارة الأساسية</span>
                <input
                  type="number"
                  value={form.standardFee}
                  onChange={(e) => setForm({ ...form, standardFee: Number(e.target.value) })}
                />
                <i>ج.م.</i>
              </label>
              <label className="field">
                <span>العملة</span>
                <input
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  placeholder="EGP"
                />
              </label>
              <label className="field">
                <span>متوسط مدة الكشف (دقيقة)</span>
                <input
                  type="number"
                  value={form.avgConsultDurationMin}
                  onChange={(e) =>
                    setForm({ ...form, avgConsultDurationMin: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div className="form-row thirds">
              <label className="field money-field">
                <span>أقصى خصم للاستقبال (قيمة)</span>
                <input
                  type="number"
                  value={form.secretaryMaxDiscount}
                  onChange={(e) =>
                    setForm({ ...form, secretaryMaxDiscount: Number(e.target.value) })
                  }
                />
                <i>ج.م.</i>
              </label>
              <label className="field">
                <span>أقصى خصم للاستقبال (٪)</span>
                <input
                  type="number"
                  value={form.secretaryMaxDiscountPct}
                  onChange={(e) =>
                    setForm({ ...form, secretaryMaxDiscountPct: Number(e.target.value) })
                  }
                />
              </label>
              <label className="field">
                <span>فترة حفظ التسجيلات (يوم)</span>
                <input
                  type="number"
                  value={form.audioRetentionDays}
                  onChange={(e) =>
                    setForm({ ...form, audioRetentionDays: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div className="modal-actions">
              <AppButton type="submit" icon="check" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? "جارٍ الحفظ..." : "حفظ الإعدادات"}
              </AppButton>
            </div>
          </form>
        )}
      </section>

      <section className="card archive-card">
        <div className="card-header">
          <div>
            <span className="section-kicker">فريق العيادة</span>
            <h2>إدارة المستخدمين</h2>
            <p>إنشاء حسابات الاستقبال وتعطيلها وإعادة تعيين كلمات المرور.</p>
          </div>
          <AppButton icon="plus" onClick={() => setShowCreate(true)}>
            حساب استقبال جديد
          </AppButton>
        </div>
        <div className="data-table">
          <div className="data-head">
            <span>الاسم</span>
            <span>المعرف</span>
            <span>الدور</span>
            <span>الحالة</span>
            <span>إجراء</span>
          </div>
          {usersQuery.isLoading && <SkeletonBlock lines={3} />}
          {users.map((u) => (
            <div className="data-row" key={u.id} style={{ cursor: "default" }}>
              <strong>{u.name}</strong>
              <span>{u.identifier}</span>
              <span>{u.role === "DOCTOR" ? "طبيب/ة" : (u.gender === "MALE" ? "موظف استقبال" : "موظفة استقبال")}</span>
              <span className={`method-pill ${u.isActive ? "" : "due-text"}`}>
                {u.isActive ? "نشط" : "معطل"}
              </span>
              <span className="row-actions" style={{ display: "flex", gap: "6px" }}>
                {u.role === "SECRETARY" && (
                  <>
                    <button
                      className="row-action"
                      onClick={() =>
                        toggleMutation.mutate({ id: u.id, activate: !u.isActive })
                      }
                      disabled={toggleMutation.isPending}
                    >
                      {u.isActive ? "تعطيل" : "تفعيل"}
                      <Icon name={u.isActive ? "lock" : "check"} size={15} />
                    </button>
                    <button
                      className="row-action"
                      onClick={() => resetMutation.mutate(u.id)}
                      disabled={resetMutation.isPending}
                    >
                      كلمة مرور مؤقتة
                      <Icon name="lock" size={15} />
                    </button>
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      {showCreate && (
        <Modal
          title="إنشاء حساب استقبال"
          subtitle="سيُطلب من الموظف تغيير كلمة المرور عند أول دخول."
          onClose={() => setShowCreate(false)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (
                createForm.name.trim() &&
                createForm.identifier.trim() &&
                createForm.password.length >= 8 &&
                createForm.gender
              ) {
                createMutation.mutate()
              }
            }}
          >
            <label className="field">
              <span>
                الاسم <b>*</b>
              </span>
              <input
                value={createForm.name}
                onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                placeholder="مثال: سارة محمود أو أحمد علي"
              />
            </label>
            <div className="field">
              <span>
                الجنس (صيغة المخاطبة) <b>*</b>
              </span>
              <div style={{ display: "flex", gap: "16px", marginTop: "6px", alignItems: "center" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: 500 }}>
                  <input
                    type="radio"
                    name="gender"
                    value="FEMALE"
                    checked={createForm.gender === "FEMALE"}
                    onChange={() => setCreateForm({ ...createForm, gender: "FEMALE" })}
                  />
                  <span>أنثى (موظفة استقبال)</span>
                </label>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer", fontWeight: 500 }}>
                  <input
                    type="radio"
                    name="gender"
                    value="MALE"
                    checked={createForm.gender === "MALE"}
                    onChange={() => setCreateForm({ ...createForm, gender: "MALE" })}
                  />
                  <span>ذكر (موظف استقبال)</span>
                </label>
              </div>
            </div>
            <div className="form-row">
              <label className="field">
                <span>
                  اسم المستخدم <b>*</b>
                </span>
                <input
                  value={createForm.identifier}
                  onChange={(e) => setCreateForm({ ...createForm, identifier: e.target.value })}
                  placeholder="مثال: sara أو ahmed"
                />
              </label>
              <label className="field">
                <span>
                  كلمة المرور الأولية (٨ أحرف+) <b>*</b>
                </span>
                <input
                  type="password"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                />
              </label>
            </div>
            <div className="modal-actions">
              <AppButton variant="outline" type="button" onClick={() => setShowCreate(false)}>
                إلغاء
              </AppButton>
              <AppButton
                type="submit"
                icon="userPlus"
                disabled={
                  createMutation.isPending ||
                  createForm.password.length < 8 ||
                  !createForm.gender ||
                  !createForm.name.trim() ||
                  !createForm.identifier.trim()
                }
              >
                {createMutation.isPending ? "جارٍ الإنشاء..." : "إنشاء الحساب"}
              </AppButton>
            </div>
          </form>
        </Modal>      )}

      {tempPassword && (
        <Modal
          title="كلمة مرور مؤقتة"
          subtitle={`لحساب ${tempPassword.name} — تُعرض مرة واحدة`}
          onClose={() => setTempPassword(null)}
        >
          <div className="receipt-paper">
            <div className="receipt-info">
              <span>
                <small>كلمة المرور المؤقتة</small>
                <strong dir="ltr">{tempPassword.password}</strong>
              </span>
            </div>
            <p className="receipt-footnote">
              اطلب من الموظف تسجيل الدخول بها فورًا — سيُطلب تغييرها في أول دخول.
            </p>
          </div>
          <div className="modal-actions">
            <AppButton variant="outline" onClick={() => setTempPassword(null)}>
              إغلاق
            </AppButton>
            <AppButton
              icon="check"
              onClick={() => {
                void navigator.clipboard?.writeText(tempPassword.password)
                notify("نُسخت كلمة المرور")
              }}
            >
              نسخ
            </AppButton>
          </div>
        </Modal>
      )}
    </>
  )
}
