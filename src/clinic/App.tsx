/**
 * App — router + providers. Route map (react-router):
 *   /login, /change-password                — auth flow
 *   /secretary/*                            — clinic operations (both roles)
 *   /doctor/*                               — clinical area (DOCTOR only)
 *   /chat                                   — intercom (both roles)
 *   /display                                — waiting-room display (authed)
 * Guards mirror the backend: role-aware navigation + mustChangePassword gate.
 */

import { lazy, Suspense, useEffect } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { AuthProvider, useAuth } from "@/clinic/auth/AuthContext"
import { RealtimeProvider } from "@/clinic/realtime/socket"
import { ToastProvider, useToast } from "@/clinic/components/ui"
import { ChatProvider } from "@/clinic/context/ChatContext"
import { AppShell } from "@/clinic/components/layout"
import { routeTitle } from "@/clinic/lib/constants"

/* ------------------------------------------------------------------ */
/* Route-based code splitting — each screen ships as its own chunk so  */
/* the login bundle stays tiny and heavy dashboards load on demand.    */
/* ------------------------------------------------------------------ */
const LoginScreen = lazy(() => import("@/clinic/screens/LoginScreen"))
const ChangePasswordScreen = lazy(() => import("@/clinic/screens/ChangePasswordScreen"))
const SecretaryDashboard = lazy(() => import("@/clinic/screens/SecretaryDashboard"))
const CheckInScreen = lazy(() => import("@/clinic/screens/CheckInScreen"))
const PaymentsScreen = lazy(() => import("@/clinic/screens/PaymentsScreen"))
const ReceiptsScreen = lazy(() => import("@/clinic/screens/ReceiptsScreen"))
const ClosingScreen = lazy(() => import("@/clinic/screens/ClosingScreen"))
const ChatScreen = lazy(() => import("@/clinic/screens/ChatScreen"))
const DoctorDashboard = lazy(() => import("@/clinic/screens/DoctorDashboard"))
const PatientsBrowserScreen = lazy(() => import("@/clinic/screens/PatientsBrowserScreen"))
const PatientProfileScreen = lazy(() => import("@/clinic/screens/PatientProfileScreen"))
const SessionScreen = lazy(() => import("@/clinic/screens/SessionScreen"))
const SoapScreen = lazy(() => import("@/clinic/screens/SoapScreen"))
const MedicationsScreen = lazy(() => import("@/clinic/screens/MedicationsScreen"))
const SettingsScreen = lazy(() => import("@/clinic/screens/SettingsScreen"))
const ReportsScreen = lazy(() => import("@/clinic/screens/ReportsScreen"))
const DisplayScreen = lazy(() => import("@/clinic/screens/DisplayScreen"))

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
    <div className="fullscreen-message" dir="rtl">
      <p>{message}</p>
    </div>
  )
}

function ShellRoute({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  const title = routeTitle[location.pathname] ?? "عيادة سكينة"
  return (
    <AppShell title={title}>
      <Suspense fallback={<ScreenLoader />}>
        {children}
      </Suspense>
    </AppShell>
  )
}

/** Smooth skeleton while a lazily-loaded screen chunk downloads. */
function ScreenLoader() {
  return (
    <div className="card" style={{ padding: "28px" }} dir="rtl" aria-busy="true" aria-label="جارٍ تحميل الشاشة">
      <div className="skeleton-block">
        <div className="skeleton-line" />
        <div className="skeleton-line" />
        <div className="skeleton-line" />
      </div>
    </div>
  )
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
              <Route
                path="/login"
                element={
                  <Suspense fallback={<FullScreenMessage message="جارٍ التحميل..." />}>
                    <LoginScreen />
                  </Suspense>
                }
              />
              <Route
                path="/change-password"
                element={
                  <RequireAuth>
                    <Suspense fallback={<FullScreenMessage message="جارٍ التحميل..." />}>
                      <ChangePasswordScreen />
                    </Suspense>
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
                    <Suspense fallback={<FullScreenMessage message="جارٍ التحميل..." />}>
                      <DisplayScreen />
                    </Suspense>
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
