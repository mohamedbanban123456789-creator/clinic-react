import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useAuth } from "@/auth/AuthContext"
import { useToast } from "@/components/ui"
import { onIntercom } from "@/realtime/socket"
import { intercomTypeLabel, type IntercomType } from "@/lib/constants"
import type { IntercomMessageDto } from "@/api/types"

interface ChatContextValue {
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  toggleChat: () => void
  openChat: () => void
  closeChat: () => void
  unreadCount: number
  resetUnreadCount: () => void
  onComplimentary?: () => void
  setOnComplimentary: (fn?: () => void) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider({ children }: { children: ReactNode }) {
  const [chatOpen, setChatOpen] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [onComplimentary, setOnComplimentary] = useState<(() => void) | undefined>(undefined)
  const { user } = useAuth()
  const { notify } = useToast()
  const queryClient = useQueryClient()

  const openChat = () => {
    setChatOpen(true)
    setUnreadCount(0)
  }

  const closeChat = () => {
    setChatOpen(false)
  }

  const toggleChat = () => {
    setChatOpen((prev) => {
      const next = !prev
      if (next) {
        setUnreadCount(0)
      }
      return next
    })
  }

  const resetUnreadCount = () => {
    setUnreadCount(0)
  }

  useEffect(() => {
    return onIntercom((msg) => {
      // Live query cache update so messages are stored immediately
      queryClient.setQueryData(
        ["intercom", "recent"],
        (prev: { data: IntercomMessageDto[]; nextCursor: string | null } | undefined) => {
          if (!prev) return prev
          if (prev.data.some((m) => m.id === msg.id)) return prev
          return { ...prev, data: [...prev.data, msg] }
        },
      )

      // Notify if received from the other role/user
      if (msg.fromUserId !== user?.id) {
        const sender = msg.fromRole === "DOCTOR" ? "الطبيب/ة" : "الاستقبال"
        const snippetText = msg.text || intercomTypeLabel[msg.type as IntercomType] || "رسالة جديدة"
        const snippet = snippetText.length > 50 ? `${snippetText.slice(0, 50)}…` : snippetText
        notify(`رسالة من ${sender}: ${snippet}`)

        setChatOpen((currentOpen) => {
          if (!currentOpen) {
            setUnreadCount((c) => c + 1)
          }
          return currentOpen
        })
      }
    })
  }, [user?.id, notify, queryClient])

  return (
    <ChatContext.Provider
      value={{
        chatOpen,
        setChatOpen: (v) => {
          if (v) setUnreadCount(0)
          setChatOpen(v)
        },
        toggleChat,
        openChat,
        closeChat,
        unreadCount,
        resetUnreadCount,
        onComplimentary,
        setOnComplimentary,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChat() {
  const ctx = useContext(ChatContext)
  if (!ctx) {
    throw new Error("useChat must be used within ChatProvider")
  }
  return ctx
}
