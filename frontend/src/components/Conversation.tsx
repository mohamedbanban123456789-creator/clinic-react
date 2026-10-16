/**
 * Conversation — internal chat preserved from the Figma export, wired to the
 * real intercom: history via GET /intercom, live messages via the
 * `intercom.received` socket event, quick templates mapped to real backend
 * intercom types.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { intercomApi } from "@/api/intercom"
import { apiErrorMessage } from "@/api/client"
import type { IntercomMessageDto } from "@/api/types"
import { onIntercom, useRealtime } from "@/realtime/socket"
import { useAuth } from "@/auth/AuthContext"
import { useToast } from "@/components/ui"
import { Icon } from "@/components/ui"
import { arTime } from "@/lib/format"
import { usersApi } from "@/api/admin"
import {
  doctorTemplates,
  getDoctorTemplates,
  intercomTypeLabel,
  secretaryTemplates,
  tSec,
  type IntercomType,
} from "@/lib/constants"

export function Conversation({
  expanded = false,
  onComplimentary,
  onFollowUp,
}: {
  expanded?: boolean
  /** Opens the doctor's "convert to complimentary" flow (billing endpoint). */
  onComplimentary?: () => void
  /** Opens the doctor's follow-up booking flow. */
  onFollowUp?: () => void
}) {
  const { user } = useAuth()
  const { notify } = useToast()
  const { connected } = useRealtime()
  const queryClient = useQueryClient()
  const role = user?.role ?? "SECRETARY"
  const isDoctor = role === "DOCTOR"

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: () => usersApi.list(),
    enabled: isDoctor,
    staleTime: 60_000,
  })

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["intercom", "recent"],
    queryFn: () => intercomApi.list(100),
    refetchOnWindowFocus: false,
  })

  // Live append of new intercom messages.
  useEffect(() => {
    return onIntercom((message) => {
      queryClient.setQueryData(["intercom", "recent"], (prev: { data: IntercomMessageDto[]; nextCursor: string | null } | undefined) => {
        if (!prev) return prev
        if (prev.data.some((m) => m.id === message.id)) return prev
        return { ...prev, data: [...prev.data, message] }
      })
    })
  }, [queryClient])

  const messages = useMemo(() => {
    const list = data?.data ?? []
    return [...list].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    )
  }, [data])

  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages.length])

  const [text, setText] = useState("")

  const sendMutation = useMutation({
    mutationFn: (input: Parameters<typeof intercomApi.send>[0]) => intercomApi.send(input),
    onSuccess: (message) => {
      queryClient.setQueryData(["intercom", "recent"], (prev: { data: IntercomMessageDto[]; nextCursor: string | null } | undefined) => {
        if (!prev) return prev
        if (prev.data.some((m) => m.id === message.id)) return prev
        return { ...prev, data: [...prev.data, message] }
      })
      notify("تم إرسال الرسالة")
    },
    onError: (err) => notify(apiErrorMessage(err), "error"),
  })

  const send = (value = text) => {
    const trimmed = value.trim()
    if (!trimmed || sendMutation.isPending) return
    setText("")
    sendMutation.mutate({ type: "CUSTOM_TEXT", text: trimmed })
  }

  const sendTemplate = (template: { label: string; type: IntercomType }) => {
    if (sendMutation.isPending) return
    if (template.type === "DOCTOR_COMPLIMENTARY") {
      onComplimentary?.()
      return
    }
    if (template.type === "DOCTOR_FOLLOWUP") {
      onFollowUp?.()
      return
    }
    sendMutation.mutate({
      type: template.type,
      text: template.label,
    })
  }

  const secUser =
    usersQuery.data?.data.find((u) => u.role === "SECRETARY" && u.isActive) ??
    usersQuery.data?.data.find((u) => u.role === "SECRETARY")
  const secGender = secUser?.gender ?? "FEMALE"
  const secName = secUser?.name || (secGender === "MALE" ? "أحمد محمود" : "سارة محمود")

  const templates = isDoctor ? getDoctorTemplates(secGender) : secretaryTemplates
  const otherName = isDoctor ? secName : "الطبيب/ة"
  const avatarInitial = isDoctor ? (secName.trim().charAt(0) || "س") : "ط"
  const statusText = isDoctor
    ? connected
      ? tSec("متصل الآن", "متصلة الآن", secGender)
      : tSec("غير متصل — الرسائل تصل عند العودة", "غير متصلة — الرسائل تصل عند العودة", secGender)
    : connected
      ? "متصل الآن"
      : "غير متصل — الرسائل تصل عند العودة"

  return (
    <div className={`conversation ${expanded ? "expanded" : ""}`}>
      <div className="conversation-header">
        <div className="online-avatar">
          {avatarInitial}
          <i />
        </div>
        <div>
          <strong>{otherName}</strong>
          <small>{statusText}</small>
        </div>
        {expanded && (
          <span className="secure-chat">
            <Icon name="lock" size={14} /> محادثة داخلية
          </span>
        )}
      </div>
      <div className="messages" ref={scrollRef}>
        {isLoading && <div className="message"><p>جارٍ تحميل الرسائل…</p></div>}
        {isError && (
          <div className="message">
            <p>تعذر تحميل المحادثة: {apiErrorMessage(error)}</p>
          </div>
        )}
        {!isLoading && !isError && messages.length === 0 && (
          <div className="message">
            <p>لا توجد رسائل بعد — ابدأ التواصل مع الفريق.</p>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.fromUserId === user?.id
          const body = m.text ?? intercomTypeLabel[m.type as IntercomType] ?? m.type
          return (
            <div className={mine ? "message mine" : "message"} key={m.id}>
              <p>{body}</p>
              <small>
                {arTime(m.createdAt)} · {m.fromRole === "DOCTOR" ? "الطبيب/ة" : "الاستقبال"}
              </small>
            </div>
          )
        })}
      </div>
      <div className="template-row">
        {templates.map((t) => (
          <button
            key={t.label}
            onClick={() => sendTemplate(t)}
            disabled={sendMutation.isPending}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="composer">
        <input
          placeholder="اكتب رسالة داخلية..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          disabled={sendMutation.isPending}
        />
        <button onClick={() => send()} disabled={sendMutation.isPending || !text.trim()}>
          <Icon name="send" size={18} />
        </button>
      </div>
    </div>
  )
}

import { useChat } from "@/context/ChatContext"

export function FloatingChat({
  open: propOpen,
  setOpen: propSetOpen,
  onComplimentary: propOnComplimentary,
}: {
  open?: boolean
  setOpen?: (v: boolean) => void
  onComplimentary?: () => void
} = {}) {
  const chatContext = useChat()
  const open = propOpen !== undefined ? propOpen : chatContext.chatOpen
  const setOpen = propSetOpen !== undefined ? propSetOpen : chatContext.setChatOpen
  const onComplimentary = propOnComplimentary ?? chatContext.onComplimentary
  const unreadCount = chatContext.unreadCount

  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"
  const partnerLabel = isDoctor ? "الاستقبال" : "الطبيب"

  return (
    <div className={open ? "floating-chat open" : "floating-chat"}>
      {open && (
        <div className="floating-panel">
          <button
            type="button"
            className="close-chat"
            onClick={() => setOpen(false)}
            aria-label="إغلاق المحادثة"
          >
            ×
          </button>
          <Conversation onComplimentary={onComplimentary} />
        </div>
      )}
      <button
        type="button"
        className="chat-toggle"
        onClick={() => chatContext.toggleChat()}
        aria-label="المحادثة الفورية"
      >
        <Icon name="message" />
        <span>{partnerLabel}</span>
        {unreadCount > 0 && <span className="chat-badge">{unreadCount}</span>}
        <i />
      </button>
    </div>
  )
}

