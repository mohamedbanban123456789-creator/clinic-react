/**
 * Auth context — session lifecycle against /api/v1/auth.
 *
 * The access JWT is kept in memory only; page reloads restore the session via
 * the HttpOnly refresh cookie (POST /auth/refresh). mustChangePassword gates
 * every route (backend mirrors this with requireFreshPassword middleware).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { authApi } from "@/api/auth"
import {
  onAuthEvent,
  setAccessToken,
  setSessionIdentity,
  tryRefresh,
} from "@/api/client"
import type { MeDto } from "@/api/types"

interface AuthContextValue {
  user: MeDto | null
  status: "loading" | "authenticated" | "unauthenticated"
  login: (identifier: string, password: string) => Promise<MeDto>
  logout: () => Promise<void>
  changePassword: (
    oldPassword: string,
    newPassword: string,
  ) => Promise<void>
  updateName: (name: string) => Promise<MeDto>
  /** Force a session re-check (e.g. after password change elsewhere). */
  reload: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeDto | null>(null)
  const [status, setStatus] = useState<"loading" | "authenticated" | "unauthenticated">(
    "loading",
  )

  const adoptUser = useCallback((me: MeDto | null) => {
    setUser(me)
    setSessionIdentity(me?.id ?? null, me?.role ?? null)
    setStatus(me ? "authenticated" : "unauthenticated")
  }, [])

  const restore = useCallback(async () => {
    // Try silent refresh first (cookie), then /auth/me.
    const ok = await tryRefresh()
    if (!ok) {
      adoptUser(null)
      return
    }
    try {
      const me = await authApi.me()
      adoptUser(me)
    } catch {
      setAccessToken(null)
      adoptUser(null)
    }
  }, [adoptUser])

  useEffect(() => {
    void restore()
    return onAuthEvent((reason) => {
      if (reason === "expired" || reason === "revoked") {
        setAccessToken(null)
        adoptUser(null)
      }
    })
  }, [restore, adoptUser])

  const login = useCallback(
    async (identifier: string, password: string): Promise<MeDto> => {
      const res = await authApi.login(identifier.trim(), password)
      setAccessToken(res.accessToken)
      setSessionIdentity(res.user.id, res.user.role)
      const me = await authApi.me()
      adoptUser(me)
      return me
    },
    [adoptUser],
  )

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      // Best-effort — clear local state regardless.
    }
    setAccessToken(null)
    adoptUser(null)
  }, [adoptUser])

  const changePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      await authApi.changePassword(oldPassword, newPassword)
      // Password change revokes all sessions (tokenVersion bump) — re-login.
      setAccessToken(null)
      adoptUser(null)
    },
    [adoptUser],
  )

  const updateName = useCallback(
    async (name: string): Promise<MeDto> => {
      const updated = await authApi.updateName(name.trim())
      adoptUser(updated)
      return updated
    },
    [adoptUser],
  )

  const reload = useCallback(async () => {
    try {
      const me = await authApi.me()
      adoptUser(me)
    } catch {
      adoptUser(null)
    }
  }, [adoptUser])

  const value = useMemo(
    () => ({ user, status, login, logout, changePassword, updateName, reload }),
    [user, status, login, logout, changePassword, updateName, reload],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used within AuthProvider")
  return ctx
}
