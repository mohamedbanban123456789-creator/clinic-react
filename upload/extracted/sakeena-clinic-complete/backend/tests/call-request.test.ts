import assert from 'node:assert/strict';
import { AppError } from '../src/common/errors/AppError.js';
import {
  createCallRequest,
  approveCallRequest,
  cancelCallRequest,
  getPendingCallRequest,
} from '../src/modules/identity-queue/queue.service.js';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// P2-2: CallRequest lifecycle unit tests with mock Prisma client
// ---------------------------------------------------------------------------
async function runTests() {
  const shiftId = 'shift-test-1';
  let queueVersion = 10;
  const doctorActor = { userId: 'doc-1', role: 'DOCTOR' as const };
  const secretaryActor = { userId: 'sec-1', role: 'SECRETARY' as const };

  let activeCallRequest: any = null;
  let activeConsultation: any = null;
  let queueEntry: any = {
    id: 'entry-1',
    shiftId,
    patientId: 'patient-1',
    status: 'WAITING',
    position: 1,
    checkedInAt: new Date(),
    calledAt: null,
    patient: { fullName: 'أحمد محمود' },
  };

  const auditLogs: any[] = [];
  const emittedEvents: any[] = [];

  const mockDb = {
    shift: {
      findFirst: async ({ where }: any) => {
        if (where?.status === 'OPEN') return { id: shiftId, queueVersion };
        return null;
      },
      findUnique: async () => ({ queueVersion }),
      update: async ({ data }: any) => {
        queueVersion = data.queueVersion?.increment ? queueVersion + 1 : data.queueVersion;
        return { queueVersion };
      },
    },
    queueEntry: {
      findFirst: async ({ where }: any) => {
        if (where?.status === 'IN_CONSULTATION') return activeConsultation;
        return null;
      },
      findMany: async ({ where }: any) => {
        if (where?.status === 'COMPLETED') return [];
        if (where?.status === 'WAITING') return [queueEntry];
        return [];
      },
      findUnique: async ({ where }: any) => {
        if (where?.id === queueEntry.id) return queueEntry;
        return null;
      },
      update: async ({ where, data }: any) => {
        if (where.id === queueEntry.id) {
          queueEntry = { ...queueEntry, ...data };
          if (data.status === 'IN_CONSULTATION') {
            activeConsultation = queueEntry;
          }
          return queueEntry;
        }
        return null;
      },
    },
    callRequest: {
      findFirst: async ({ where }: any) => {
        if (where?.status === 'PENDING') return activeCallRequest;
        return null;
      },
      findUnique: async ({ where }: any) => {
        if (activeCallRequest && where.id === activeCallRequest.id) return activeCallRequest;
        return null;
      },
      create: async ({ data }: any) => {
        activeCallRequest = {
          id: 'call-req-1',
          queueEntryId: data.queueEntryId,
          requestedByUserId: data.requestedByUserId,
          status: data.status ?? 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          queueEntry,
        };
        return activeCallRequest;
      },
      update: async ({ where, data }: any) => {
        if (activeCallRequest && where.id === activeCallRequest.id) {
          activeCallRequest = { ...activeCallRequest, ...data, updatedAt: new Date() };
          return activeCallRequest;
        }
        return null;
      },
    },
    auditEvent: {
      create: async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      },
      findUnique: async () => null,
    },
    encounter: {
      findMany: async () => [],
    },
    $transaction: async (fn: any) => fn(mockDb),
  } as unknown as PrismaClient;

  // 1. Initial state: getPendingCallRequest returns null
  {
    const res = await getPendingCallRequest(doctorActor, mockDb);
    assert.equal(res, null, 'initially no pending call request');
  }

  // 2. Doctor creates a call request for entry-1
  {
    const res = await createCallRequest({ entryId: 'entry-1' }, doctorActor, mockDb);
    assert.equal(res.id, 'call-req-1');
    assert.equal(res.status, 'PENDING');
    assert.equal(res.patientName, 'أحمد محمود');
    assert.equal(res.requestedByUserId, 'doc-1');

    // Audit written
    const lastAudit = auditLogs.find((a) => a.action === 'CALL_REQUEST_CREATE');
    assert.ok(lastAudit, 'CALL_REQUEST_CREATE audit must be logged');
    assert.equal(lastAudit.actorUserId, 'doc-1');
  }

  // 3. Pending call request is retrievable
  {
    const res = await getPendingCallRequest(secretaryActor, mockDb);
    assert.ok(res !== null, 'pending call request must be found');
    assert.equal(res?.id, 'call-req-1');
    assert.equal(res?.status, 'PENDING');
  }

  // 4. Duplicate call request is blocked with PENDING_CALL_REQUEST_EXISTS (409)
  {
    await assert.rejects(
      async () => createCallRequest({ entryId: 'entry-1' }, doctorActor, mockDb),
      (err: any) => err instanceof AppError && err.code === 'PENDING_CALL_REQUEST_EXISTS',
      'duplicate pending request must be rejected with 409',
    );
  }

  // 5. Cancel call request
  {
    const res = await cancelCallRequest('call-req-1', doctorActor, mockDb);
    assert.equal(res.status, 'CANCELLED');
    const cancelAudit = auditLogs.find((a) => a.action === 'CALL_REQUEST_CANCEL');
    assert.ok(cancelAudit, 'CALL_REQUEST_CANCEL audit must be logged');
  }

  // Reset activeCallRequest for approve test
  activeCallRequest = null;

  // 6. Doctor creates a new call request (without entryId: picks head of WAITING pool)
  {
    const res = await createCallRequest({}, doctorActor, mockDb);
    assert.equal(res.status, 'PENDING');
    assert.equal(res.queueEntryId, 'entry-1');
  }

  // 7. Secretary approves call request
  {
    const res = await approveCallRequest('call-req-1', secretaryActor, mockDb);
    assert.equal(res.status, 'APPROVED');
    assert.equal(queueEntry.status, 'IN_CONSULTATION');
    assert.ok(queueEntry.calledAt !== null, 'calledAt must be populated');

    const approveAudit = auditLogs.find((a) => a.action === 'CALL_REQUEST_APPROVE');
    assert.ok(approveAudit, 'CALL_REQUEST_APPROVE audit must be logged');
    assert.equal(approveAudit.actorUserId, 'sec-1');

    const queueCallAudit = auditLogs.find((a) => a.action === 'QUEUE_CALL');
    assert.ok(queueCallAudit, 'QUEUE_CALL audit must be logged');
  }

  // 8. Active consultation blocks new call request
  {
    await assert.rejects(
      async () => createCallRequest({}, doctorActor, mockDb),
      (err: any) => err instanceof AppError && err.code === 'ACTIVE_CONSULTATION_EXISTS',
      'active consultation must block new call request',
    );
  }

  // eslint-disable-next-line no-console
  console.log('P2-2 CallRequest lifecycle tests passed.');
}

runTests().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('CallRequest test failed:', err);
  process.exit(1);
});
