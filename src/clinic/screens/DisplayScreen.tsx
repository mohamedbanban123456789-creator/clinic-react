/**
 * Waiting-room display — design language (hero gradient + Cairo numerals).
 * Privacy mode shows queue numbers ONLY (no names), which is the default for
 * the public screen. NOTE (documented limitation): the backend exposes no
 * unauthenticated queue endpoint — every queue read requires a valid staff
 * JWT — so this display must run inside an authenticated staff session
 * (e.g. a reception browser kept signed in). This is surfaced honestly in
 * the UI footer rather than faking public access.
 */

import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useQueue } from "@/clinic/hooks/useQueue"
import { motion } from "framer-motion"
import { listStagger, rise } from "@/clinic/motion"
import { Icon, useToast } from "@/clinic/components/ui"
import { useAuth } from "@/clinic/auth/AuthContext"
import { arNum, arToday, arTime } from "@/clinic/lib/format"

export default function DisplayScreen() {
  const [privacy, setPrivacy] = useState(true)
  const { entries, queue } = useQueue()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { notify } = useToast()

  const waiting = entries.filter((e) => e.status === "WAITING")
  const current = entries.find((e) => e.status === "IN_CONSULTATION")

  return (
    <div className="display-screen" dir="rtl">
      <header className="display-header">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <Icon name="heart" size={24} />
          </div>
          <div>
            <strong>عيادة سكينة</strong>
            <small>{arToday()}</small>
          </div>
        </div>
        <div className="display-controls">
          <button
            className={privacy ? "btn btn-secondary" : "btn btn-outline"}
            onClick={() => {
              setPrivacy(!privacy)
              notify(privacy ? "تم إظهار الأسماء (وضع الموظف)" : "تم تفعيل وضع الخصوصية")
            }}
            title={privacy ? "إظهار الأسماء" : "إخفاء الأسماء (خصوصية المرضى)"}
          >
            <Icon name={privacy ? "eye" : "lock"} size={16} />
            {privacy ? "وضع الخصوصية مفعّل" : "الأسماء ظاهرة"}
          </button>
          <button className="btn btn-outline" onClick={() => navigate(-1)}>
            <Icon name="arrow" size={16} /> عودة
          </button>
        </div>
      </header>

      <main className="display-body">
        <section className="display-now">
          <span className="eyebrow light">الدور الآن</span>
          {current ? (
            <>
              <h1 className="display-number">{arNum(current.position)}</h1>
              {!privacy && <p className="display-name">{current.displayName}</p>}
              <small>يرجى التوجه إلى غرفة الكشف · بدأت {arTime(current.calledAt)}</small>
            </>
          ) : (
            <>
              <span className="display-idle-icon" aria-hidden="true">
                <Icon name="activity" size={40} />
              </span>
              <h1 className="display-number">—</h1>
              <small>لا يوجد مريض مع الطبيب حاليًا — سيظهر الدور هنا فور الاستدعاء</small>
            </>
          )}
        </section>

        <section className="display-queue">
          <div className="mini-title">
            <span className="live-dot" /> التالي ({arNum(waiting.length)})
          </div>
          {waiting.length === 0 && (
            <div className="display-empty">
              <Icon name="users" size={28} />
              <p>لا مرضى في الانتظار الآن</p>
              <small>سيظهر الطابور هنا تلقائيًا فور تسجيل الحضور في الاستقبال</small>
            </div>
          )}
          <motion.div
            className="display-grid"
            variants={listStagger}
            initial="hidden"
            animate="visible"
          >
            {waiting.slice(0, 8).map((e, i) => (
              <motion.div
                className="display-tile"
                key={e.entryId}
                layout
                variants={rise}
              >
                <strong>{arNum(i + 1)}</strong>
                {!privacy && <span>{e.displayName}</span>}
                {e.isEmergency && (
                  <span className="emergency-tag">
                    <Icon name="alert" size={12} /> طارئ
                  </span>
                )}
                <small>نحو {arNum(e.estimatedWaitMin)} دقيقة</small>
              </motion.div>
            ))}
          </motion.div>
        </section>
      </main>

      <footer className="display-footer">
        <Icon name="lock" size={14} />
        <span>
          شاشة داخلية — تعمل بجلسة موظف ({user?.name ?? ""}) · لا تتيح النظام وصولًا
          عامًا غير مصرح به لبيانات الطابور
        </span>
      </footer>
    </div>
  )
}
