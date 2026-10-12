/** Auth endpoints — /api/v1/auth */

import { apiRequest } from "./client"
import type { LoginResponse, MeDto, RefreshResponse } from "./types"

export const authApi = {
  login(identifier: string, password: string): Promise<LoginResponse> {
    return apiRequest<LoginResponse>("/auth/login", {
      method: "POST",
      body: { identifier, password },
      skipRefresh: true,
    })
  },

  refresh(): Promise<RefreshResponse> {
    return apiRequest<RefreshResponse>("/auth/refresh", {
      method: "POST",
      skipRefresh: true,
    })
  },

  logout(): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>("/auth/logout", {
      method: "POST",
      skipRefresh: true,
    })
  },

  me(): Promise<MeDto> {
    return apiRequest<MeDto>("/auth/me")
  },

  changePassword(
    oldPassword: string,
    newPassword: string,
  ): Promise<{ ok: boolean }> {
    return apiRequest<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: { oldPassword, newPassword },
      skipRefresh: true,
    })
  },
}
