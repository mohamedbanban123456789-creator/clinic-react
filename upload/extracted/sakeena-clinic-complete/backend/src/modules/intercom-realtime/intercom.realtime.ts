import type { Socket } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../../common/prisma.js';
import { AppError } from '../../common/errors/AppError.js';
import { logger } from '../../common/utils/logger.js';
import { sendIntercom } from './intercom.service.js';
import { intercomSendSchema, ownershipAllows } from './intercom.validators.js';
import type { WsSession } from '../../ws-gateway.js';

/**
 * BE-402 WS `intercom.send` handler.
 *
 * Validates the payload (Zod), enforces role-type ownership (forged type ->
 * FORBIDDEN error frame, NO broadcast), then persists + broadcasts via the
 * intercom service. The caller (ws-gateway) invokes this per connection so the
 * handler can close over the authenticated socket session.
 *
 * Invariant: DOCTOR_COMPLIMENTARY is notification-only. A chat `intercom.send`
 * with that type is rejected here (financial complimentary stays REST-only), so
 * the chat channel NEVER performs a financial write.
 */
export function handleIntercomSend(socket: Socket, session: WsSession, db: PrismaClient = prisma): void {
  socket.on('intercom.send', (payload: unknown) => {
    const parsed = intercomSendSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit('intercom.error', {
        code: 'UNPROCESSABLE',
        message: 'Invalid intercom payload',
        details: parsed.error.issues.map((i) => ({ field: i.path.join('.'), issue: i.message })),
      });
      return;
    }
    const input = parsed.data;

    // Role-type ownership: reject forged types with a FORBIDDEN frame, no broadcast.
    if (!ownershipAllows(session.role, input.type)) {
      socket.emit('intercom.error', {
        code: 'FORBIDDEN',
        message: 'Role is not permitted to send this intercom type',
        details: [{ field: 'type', issue: 'forbidden type for role', expected: session.role }],
      });
      return;
    }

    // Notification-only guard: the chat channel never performs a financial write.
    if (input.type === 'DOCTOR_COMPLIMENTARY') {
      socket.emit('intercom.error', {
        code: 'FORBIDDEN',
        message: 'DOCTOR_COMPLIMENTARY is notification-only; use the billing complimentary endpoint',
        details: [],
      });
      return;
    }

    sendIntercom(input, { userId: session.userId, role: session.role }, db)
      .then((result) => {
        socket.emit('intercom.ack', {
          id: result.message.id,
          followUpId: result.followUp === null ? null : result.followUp.id,
          serverAt: new Date().toISOString(),
        });
      })
      .catch((err: unknown) => {
        if (err instanceof AppError) {
          socket.emit('intercom.error', {
            code: err.code,
            message: err.message,
            details: err.details,
          });
          return;
        }
        logger.warn('intercom.ws.sendFailed', { err: String(err) });
        socket.emit('intercom.error', { code: 'INTERNAL', message: 'Failed to send intercom message', details: [] });
      });
  });
}
