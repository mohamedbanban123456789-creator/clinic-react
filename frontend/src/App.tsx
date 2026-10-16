/**
 * App — router + providers. Route map (react-router):
 *   /login, /change-password                — auth flow
 *   /secretary/*                            — clinic operations (both roles)
 *   /doctor/*                               — clinical area (DOCTOR only)
 *   /chat                                   — intercom (both roles)
 *   /display                                — waiting-room display (authed)
 * Guards mirror the backend: role-aware navigation + mustChangePassword gate.
 */

import { useEffect } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "@/auth/AuthContext"
import { RealtimeProvider } from "@/realtime/socket"
import { ToastProvider, useToast } from "@/components/ui"
import { ChatProvider } from "@/context/ChatContext"
import { AppShell } from "@/components/layout"
import { routeTitle } from "@/lib/constants"

import LoginScreen from "@/screens/LoginScreen"
import ChangePasswordScreen from "@/screens/ChangePasswordScreen"
import SecretaryDashboard from "@/screens/SecretaryDashboard"
import CheckInScreen from "@/screens/CheckInScreen"
import PaymentsScreen from "@/screens/PaymentsScreen"
import ReceiptsScreen from "@/screens/ReceiptsScreen"
import ClosingScreen from "@/screens/ClosingScreen"
import ChatScreen from "@/screens/ChatScreen"
import DoctorDashboard from "@/screens/DoctorDashboard"
import PatientsBrowserScreen from "@/screens/PatientsBrowserScreen"
import PatientProfileScreen from "@/screens/PatientProfileScreen"
import SessionScreen from "@/screens/SessionScreen"
import SoapScreen from "@/screens/SoapScreen"
import MedicationsScreen from "@/screens/MedicationsScreen"
import SettingsScreen from "@/screens/SettingsScreen"
import ReportsScreen from "@/screens/ReportsScreen"
import DisplayScreen from "@/screens/DisplayScreen"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 15_000,
      refetchOnWindowFocus: true,
    },
  },
})

function FullScreenMessage({ message }: { message: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        fontFamily: "Cairo, sans-serif",
        color: "#72758a",
        background: "#f6f7fc",
      }}
      dir="rtl"
    >
      <p>{message}</p>
    </div>
  )
}

function ShellRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const title = routeTitle[location.pathname] ?? "عيادة سكينة"
  return <AppShell title={title}>{children}</AppShell>
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth()
  const location = useLocation()
  if (status === "loading") return <FullScreenMessage message="جارٍ استعادة الجلسة..." />
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />
  if (user.passwordMustChange && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />
  }
  if (!user.passwordMustChange && location.pathname === "/change-password") {
    return <Navigate to={user.role === "DOCTOR" ? "/doctor" : "/secretary"} replace />
  }
  return <>{children}</>
}

function RequireDoctor({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { notify } = useToast()
  const denied = Boolean(user && user.role !== "DOCTOR")

  // Fire the denial toast in an effect (never during render).
  useEffect(() => {
    if (denied) notify("هذه المساحة متاحة لحساب الطبيب فقط", "error")
  }, [denied, notify])

  if (denied) {
    return <Navigate to="/secretary" replace />
  }
  return <>{children}</>
}

function RequireSecretary({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  if (user?.role === "DOCTOR") {
    return <Navigate to="/doctor" replace />
  }
  return <>{children}</>
}

function HomeRedirect() {
  const { user } = useAuth()
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={user.role === "DOCTOR" ? "/doctor" : "/secretary"} replace />
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <RealtimeProvider>
            <ChatProvider>
              <Routes>
              <Route path="/login" element={<LoginScreen />} />
              <Route
                path="/change-password"
                element={
                  <RequireAuth>
                    <ChangePasswordScreen />
                  </RequireAuth>
                }
              />
              <Route
                path="/secretary"
                element={
                  <RequireAuth>
                    <RequireSecretary>
                      <ShellRoute>
                        <SecretaryDashboard />
                      </ShellRoute>
                    </RequireSecretary>
                  </RequireAuth>
                }
              />
              <Route
                path="/secretary/checkin"
                element={
                  <RequireAuth>
                    <RequireSecretary>
                      <ShellRoute>
                        <CheckInScreen />
                      </ShellRoute>
                    </RequireSecretary>
                  </RequireAuth>
                }
              />
              <Route
                path="/secretary/payments"
                element={
                  <RequireAuth>
                    <RequireSecretary>
                      <ShellRoute>
                        <PaymentsScreen />
                      </ShellRoute>
                    </RequireSecretary>
                  </RequireAuth>
                }
              />
              <Route
                path="/secretary/receipts"
                element={
                  <RequireAuth>
                    <RequireSecretary>
                      <ShellRoute>
                        <ReceiptsScreen />
                      </ShellRoute>
                    </RequireSecretary>
                  </RequireAuth>
                }
              />
              <Route
                path="/secretary/closing"
                element={
                  <RequireAuth>
                    <RequireSecretary>
                      <ShellRoute>
                        <ClosingScreen />
                      </ShellRoute>
                    </RequireSecretary>
                  </RequireAuth>
                }
              />
              <Route
                path="/chat"
                element={
                  <RequireAuth>
                    <Navigate to="/" replace />
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <DoctorDashboard />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/patients"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <PatientsBrowserScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/patients/:id"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <PatientProfileScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/session"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <SessionScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/soap"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <SoapScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/medications"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <MedicationsScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/medications/:id"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <MedicationsScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/settings"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <SettingsScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/doctor/reports"
                element={
                  <RequireAuth>
                    <RequireDoctor>
                      <ShellRoute>
                        <ReportsScreen />
                      </ShellRoute>
                    </RequireDoctor>
                  </RequireAuth>
                }
              />
              <Route
                path="/display"
                element={
                  <RequireAuth>
                    <DisplayScreen />
                  </RequireAuth>
                }
              />
              <Route path="/" element={<HomeRedirect />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </ChatProvider>
          </RealtimeProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
