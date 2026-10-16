/**
 * Role-aware "today's invoices" aggregation that respects the backend's
 * blind-close rules (DB-10):
 *   - DOCTOR: shift-scoped GET /billing?shiftId=… (always allowed).
 *   - SECRETARY: shift-scoped aggregate reads are 403 while the shift is
 *     OPEN, but patient-scoped reads are allowed — so we fan out one
 *     patient-scoped query per patient in today's queue. This is the
 *     backend-sanctioned path for the desk.
 */

import { useMemo } from "react"
import { useQueries, useQuery } from "@tanstack/react-query"
import { billingApi } from "@/clinic/api/billing"
import { queueApi } from "@/clinic/api/queue"
import { useAuth } from "@/clinic/auth/AuthContext"
import type { InvoiceListItemDto } from "@/clinic/api/types"

export function useShiftInvoices(shiftId: string | undefined) {
  const { user } = useAuth()
  const isDoctor = user?.role === "DOCTOR"

  const queueQuery = useQuery({
    queryKey: ["queue", "current"],
    queryFn: () => queueApi.list(),
    enabled: Boolean(shiftId) && !isDoctor,
    refetchInterval: 60_000,
  })

  const patientIds = useMemo(() => {
    const ids = [...new Set((queueQuery.data?.entries ?? []).map((e) => e.patientId))]
    return ids.sort()
  }, [queueQuery.data])

  const doctorQuery = useQuery({
    queryKey: ["billing", "shift-scope", shiftId ?? "none"],
    queryFn: () => billingApi.invoices({ shiftId: shiftId!, limit: 200 }),
    enabled: Boolean(shiftId) && isDoctor,
    refetchInterval: 60_000,
  })

  // Secretary path: one cached patient-scoped query per queue patient.
  const patientQueries = useQueries({
    queries: patientIds.map((patientId) => ({
      queryKey: ["billing", "patient-scope", patientId],
      queryFn: () => billingApi.invoices({ patientId, limit: 50 }),
      staleTime: 30_000,
    })),
  })

  const secretaryInvoices = useMemo(() => {
    if (isDoctor || !shiftId) return [] as InvoiceListItemDto[]
    const all: InvoiceListItemDto[] = []
    for (const q of patientQueries) {
      if (q.data) all.push(...q.data.data)
    }
    // Patient-scoped reads span all shifts — restrict to invoices whose
    // queueEntryId belongs to the current shift's queue.
    const todayEntryIds = new Set((queueQuery.data?.entries ?? []).map((e) => e.entryId))
    const seen = new Set<string>()
    return all
      .filter((inv) => todayEntryIds.has(inv.queueEntryId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .filter((inv) => {
        if (seen.has(inv.invoiceId)) return false
        seen.add(inv.invoiceId)
        return true
      })
  }, [patientQueries, isDoctor, shiftId, queueQuery.data])

  const isLoading = isDoctor ? doctorQuery.isLoading : patientQueries.some((q) => q.isLoading)
  const isError = isDoctor
    ? doctorQuery.isError
    : patientQueries.length > 0 && patientQueries.every((q) => q.isError)

  return {
    invoices: isDoctor ? (doctorQuery.data?.data ?? []) : secretaryInvoices,
    isLoading,
    isError,
    error: doctorQuery.error,
  }
}
