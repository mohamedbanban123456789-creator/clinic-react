/**
 * Chat screen — full-page intercom conversation (design preserved) plus a
 * follow-ups side panel (same design language): doctor's DOCTOR_FOLLOWUP
 * messages create FollowUpTask rows the secretary can schedule/complete.
 * The "convert to complimentary" template opens the real billing flow.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Conversation } from "@/clinic/components/Conversation"
import { intercomApi } from "@/clinic/api/intercom"
import { billingApi } from "@/clinic/api/billing"
import { queueApi } from "@/clinic/api/queue"
import { apiErrorMessage } from "@/clinic/api/client"
import { AppButton, Icon, Modal, useToast } from "@/clinic/components/ui"
import { useAuth } from "@/clinic/auth/AuthContext"
import { arAgo, arNum, moneyMinor } from "@/clinic/lib/format"
import { followUpStatusLabel } from "@/clinic/lib/constants"
import type { QueueEntryDto } from "@/clinic/api/types"

function PickEntryModal({
  title,
  subtitle,
  entries,
  onPick,
  onClose,
}: {
  title: string
  subtitle: string
  entries: QueueEntryDto[]
  onPick: (entry: QueueEntryDto) => void
  onClose: () => void
}) {
  return (
    <Modal title={title} subtitle={subtitle} onClose={onClose}>
      <div className="data-table">
        {entries.length === 0 && (
          <div className="data-row">
            <span>لا توجد زيارات في طابور اليوم بعد.</span>
          </div>
        )}
        {entries.map((e, i) => (
          <button key={e.entryId} className="data-row" onClick={() => onPick(e)}>
            <strong>{e.displayName}</strong>
            <span className={`patient-avatar a${i % 4}`}>{e.displayName.charAt(0)}</span>
            <span>{e.status === "IN_CONSULTATION" ? "مع الطبيب" : "في الطابور"}</span>
            <Icon name="chevron" size={16} />
          </button>
        ))}
      </div>
      <div className="modal-actions">
        <AppButton variant="outline" onClick={onClose}>
          إلغاء
        </AppButton>
      </div>
    </Modal>
  )
}

export default function ChatScreen() {
  const { user } = useAuth()
  const { notify } = useToast()
  const queryClient = useQueryClient()
  const isDoctor = user?.role === "DOCTOR"

  const [showComplimentary, setShowComplimentary] = useState(false)
  const [showFollowUp, setShowFollowUp] = useState(false)
  const [complimentaryBusy, setComplimentaryBusy] = useState(false)

  const queueQuery = useQuery({
    queryKey: ["queue", "current"],
    queryFn: () => queueApi.list(),
  })

  const followUpsQuery = useQuery({
    queryKey: ["followups", "open"],
    queryFn: () => intercomApi.followUps({ limit: 50 }),
  })

  const followUpMutation = useMutation({
    mutationFn: (args: { id: string; status: "SCHEDULED" | "DONE" | "CANCELLED" }) =>
      intercomApi.updateFollowUp(args.id, args.status),
    onSuccess: (fu) => {
      notify(`تم تحديث المتابعة (${followUpStatusLabel[fu.status]})`)
      void queryClient.invalidateQueries({ queryKey: ["followups"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const complimentaryMutation = useMutation({
    mutationFn: (entry: QueueEntryDto) =>
      billingApi.complimentary({ queueEntryId: entry.entryId }),
    onSuccess: (checkout) => {
      notify(
        `تم تحويل زيارة ${checkout.patientId.slice(-6)} إلى استشارة مجانية — الفاتورة: ${moneyMinor(checkout.finalFeeMinor)}`,
      )
      setShowComplimentary(false)
      void queryClient.invalidateQueries({ queryKey: ["billing"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const followUpSendMutation = useMutation({
    mutationFn: (entry: QueueEntryDto) =>
      intercomApi.send({
        type: "DOCTOR_FOLLOWUP",
        relatedQueueEntryId: entry.entryId,
        followUp: { followUpType: "GENERAL", window: "NEXT_VISIT" },
      }),
    onSuccess: () => {
      notify("طلبت متابعة للمريض في الزيارة القادمة")
      setShowFollowUp(false)
      void queryClient.invalidateQueries({ queryKey: ["followups"] })
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const openFollowUps = (followUpsQuery.data?.data ?? []).filter(
    (f) => f.status === "REQUESTED" || f.status === "SCHEDULED",
  )

  const selectableEntries = (queueQuery.data?.entries ?? []).filter(
    (e) => e.status === "WAITING" || e.status === "IN_CONSULTATION",
  )

  return (
    <>
      <div className="chat-page card">
        <Conversation
          expanded
          onComplimentary={() => setShowComplimentary(true)}
          onFollowUp={() => setShowFollowUp(true)}
        />
      </div>

      <section className="card archive-card" style={{ marginTop: "16px" }}>
        <div className="card-header">
          <div>
            <span className="section-kicker">مهام المتابعة</span>
            <h3>طلبات المتابعة القادمة</h3>
            <p>تُنشأ من رسائل الطبيب — جدولها أو أنهها بعد التنسيق مع المريض.</p>
          </div>
        </div>
        <div className="data-table">
          <div className="data-head">
            <span>المريض</span>
            <span>الطلب</span>
            <span>طُلب</span>
            <span>الحالة</span>
            <span>إجراء</span>
          </div>
          {followUpsQuery.isLoading && (
            <div className="data-row">
              <span>جارٍ التحميل…</span>
            </div>
          )}
          {openFollowUps.length === 0 && !followUpsQuery.isLoading && (
            <div className="data-row">
              <span>لا مهام متابعة مفتوحة حاليًا.</span>
            </div>
          )}
          {openFollowUps.map((f) => (
            <div className="data-row" key={f.id} style={{ cursor: "default" }}>
              <strong>{f.patientId.slice(-6)}</strong>
              <span>{f.note}</span>
              <span>{arAgo(f.requestedAt)}</span>
              <span className="method-pill">{followUpStatusLabel[f.status]}</span>
              <span className="row-actions">
                {f.status === "REQUESTED" && (
                  <button
                    className="row-action"
                    onClick={() => followUpMutation.mutate({ id: f.id, status: "SCHEDULED" })}
                    disabled={followUpMutation.isPending}
                  >
                    جدولة
                    <Icon name="arrow" size={15} />
                  </button>
                )}
                {(f.status === "REQUESTED" || f.status === "SCHEDULED") && (
                  <>
                    <button
                      className="row-action"
                      onClick={() => followUpMutation.mutate({ id: f.id, status: "DONE" })}
                      disabled={followUpMutation.isPending}
                    >
                      إنهاء
                      <Icon name="check" size={15} />
                    </button>
                    {isDoctor && (
                      <button
                        className="row-action"
                        onClick={() => followUpMutation.mutate({ id: f.id, status: "CANCELLED" })}
                        disabled={followUpMutation.isPending}
                      >
                        إلغاء
                        <Icon name="alert" size={15} />
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
          ))}
        </div>
      </section>

      {showComplimentary && (
        <PickEntryModal
          title="تحويل زيارة إلى استشارة مجانية"
          subtitle="اختر زيارة من طابور اليوم — يتطلب صلاحية الطبيب ويثبت السبب في السجل."
          entries={selectableEntries}
          onPick={(entry) => complimentaryMutation.mutate(entry)}
          onClose={() => setShowComplimentary(false)}
        />
      )}

      {showFollowUp && (
        <PickEntryModal
          title="طلب متابعة في الزيارة القادمة"
          subtitle="اختر زيارة — سيُنشأ مهام متابعة يراها الاستقبال هنا."
          entries={selectableEntries}
          onPick={(entry) => followUpSendMutation.mutate(entry)}
          onClose={() => setShowFollowUp(false)}
        />
      )}
    </>
  )
}
