import type { Server as HttpServer } from 'node:http';
import { Server as IOServer, type Socket } from 'socket.io';
import type { PrismaClient } from '@prisma/client';
import { prisma } from './common/prisma.js';
import { verifyAccessTokenDetailed } from './common/utils/jwt.js';
import { logger } from './common/utils/logger.js';
import { attachRealtime, setQueueSnapshotPublisher } from './common/realtime.js';
import { roomsForRole } from './common/rooms.js';
import { buildQueueSnapshots } from './modules/identity-queue/queue.snapshot.js';
import { handleIntercomSend } from './modules/intercom-realtime/intercom.realtime.js';

/**
 * BE-401 WebSocket Gateway (Socket.io, RPS-2).
 *
 * Attached to the existing HTTP server in server.ts. Handshake authenticates
 * the access JWT, joins role-segregated rooms, schedules a token-expiry
 * disconnect (unless refreshed via `auth.refresh`), and replays the latest
 * queue.snapshot on (re)connect. Queue mutations publish a fresh snapshot; the
 * intercom send handler lives in the intercom-realtime module.
 */

export interface WsGatewayOptions {
  readonly corsOrigin: string;
  readonly db?: PrismaClient;
}

export interface WsGateway {
  readonly io: IOServer;
  close(): void;
}

interface HandshakeAuth {
  readonly token?: unknown;
}

/** Socket-scoped session captured at handshake. */
export interface WsSession {
  readonly userId: string;
  readonly role: 'DOCTOR' | 'SECRETARY';
  readonly tokenVersion: number;
  exp: number | null;
  expiryTimer: NodeJS.Timeout | null;
}

function readToken(socket: Socket): string | null {
  const auth = socket.handshake.auth as HandshakeAuth | undefined;
  const token = auth?.token;
  return typeof token === 'string' && token.trim().length > 0 ? token : null;
}

function scheduleExpiry(socket: Socket, session: WsSession): void {
  if (session.expiryTimer !== null) {
    clearTimeout(session.expiryTimer);
    session.expiryTimer = null;
  }
  if (session.exp === null) return;
  const delayMs = session.exp * 1000 - Date.now();
  if (delayMs <= 0) {
    socket.disconnect(true);
    return;
  }
  session.expiryTimer = setTimeout(() => {
    logger.info('ws.token.expired.disconnect', { userId: session.userId });
    socket.emit('session.expired', { serverAt: new Date().toISOString() });
    socket.disconnect(true);
  }, delayMs);
  // Do not keep the event loop alive solely for the expiry timer.
  session.expiryTimer.unref?.();
}


/** Replay the latest role-appropriate queue.snapshot to a (re)connecting socket. */
async function replaySnapshot(socket: Socket, session: WsSession, db: PrismaClient): Promise<void> {
  try {
    const built = await buildQueueSnapshots(db);
    if (built === null) return;
    socket.emit('queue.snapshot', session.role === 'DOCTOR' ? built.doctor : built.ops);
  } catch (err) {
    logger.warn('ws.replaySnapshot.failed', { userId: session.userId, err: String(err) });
  }
}

export function createWsGateway(httpServer: HttpServer, options: WsGatewayOptions): WsGateway {
  const db = options.db ?? prisma;
  const io = new IOServer(httpServer, {
    cors: { origin: options.corsOrigin, credentials: true },
  });

  io.use((socket, next) => {
    const token = readToken(socket);
    if (token === null) {
      next(new Error('connect_error:401 missing token'));
      return;
    }
    let sub: string;
    let role: 'DOCTOR' | 'SECRETARY';
    let tv: number;
    let exp: number | null;
    try {
      const verified = verifyAccessTokenDetailed(token);
      sub = verified.claims.sub;
      role = verified.claims.role;
      tv = verified.claims.tv;
      exp = verified.exp;
    } catch {
      next(new Error('connect_error:401 invalid or expired token'));
      return;
    }
    db.user
      .findUnique({ where: { id: sub }, select: { id: true, role: true, isActive: true, tokenVersion: true } })
      .then((user) => {
        if (user === null) {
          next(new Error('connect_error:401 unknown user'));
          return;
        }
        if (!user.isActive) {
          next(new Error('connect_error:403 account deactivated'));
          return;
        }
        if (user.role !== role || user.tokenVersion !== tv) {
          next(new Error('connect_error:401 session revoked'));
          return;
        }
        const session: WsSession = {
          userId: user.id,
          role: user.role,
          tokenVersion: user.tokenVersion,
          exp,
          expiryTimer: null,
        };
        socket.data.session = session;
        next();
      })
      .catch((err: unknown) => {
        logger.warn('ws.handshake.dbError', { err: String(err) });
        next(new Error('connect_error:401 auth lookup failed'));
      });
  });

  io.on('connection', (socket: Socket) => {
    const session = socket.data.session as WsSession | undefined;
    if (session === undefined) {
      socket.disconnect(true);
      return;
    }
    for (const room of roomsForRole(session.role, session.userId)) {
      socket.join(room);
    }
    scheduleExpiry(socket, session);
    void replaySnapshot(socket, session, db);

    // Token refresh: accept a fresh access JWT and re-arm the expiry timer.
    socket.on('auth.refresh', (payload: unknown) => {
      const token = (payload as HandshakeAuth | undefined)?.token;
      if (typeof token !== 'string' || token.trim().length === 0) {
        socket.emit('error', { code: 'BAD_REQUEST', message: 'token is required' });
        return;
      }
      let verified: ReturnType<typeof verifyAccessTokenDetailed>;
      try {
        verified = verifyAccessTokenDetailed(token);
      } catch {
        socket.emit('error', { code: 'UNAUTHORIZED', message: 'invalid or expired token' });
        socket.disconnect(true);
        return;
      }
      if (verified.claims.sub !== session.userId) {
        socket.emit('error', { code: 'UNAUTHORIZED', message: 'token subject mismatch' });
        socket.disconnect(true);
        return;
      }
      // Re-check activation + token version (a refreshed token from a revoked
      // session must not re-arm the expiry timer).
      void db.user
        .findUnique({ where: { id: session.userId }, select: { isActive: true, tokenVersion: true } })
        .then((user) => {
          if (user === null || !user.isActive || user.tokenVersion !== verified.claims.tv) {
            socket.emit('error', { code: 'UNAUTHORIZED', message: 'session revoked' });
            socket.disconnect(true);
            return;
          }
          session.exp = verified.exp;
          scheduleExpiry(socket, session);
          socket.emit('session.refreshed', { serverAt: new Date().toISOString() });
        })
        .catch(() => {
          // Fail-closed: a failed revalidation must not leave the socket running on
          // the old (possibly stale) expiry timer with unverified activation state.
          socket.emit('error', { code: 'INTERNAL', message: 'session revalidation failed' });
          socket.disconnect(true);
        });
    });

    // App-level heartbeat echo: the client sends `ping` every 25 s and expects
    // `pong` (link-state LIVE/DEGRADED contract). Socket.io's engine-level
    // ping/pong is separate and unnamed, so this listener is required.
    socket.on('ping', () => {
      socket.emit('pong');
    });

    // BE-402 intercom send (delegates to the intercom-realtime module).
    handleIntercomSend(socket, session, db);

    socket.on('disconnect', () => {
      if (session.expiryTimer !== null) clearTimeout(session.expiryTimer);
      session.expiryTimer = null;
    });
  });

  attachRealtime(io);
  setQueueSnapshotPublisher((clinicDayId: string) => {
    void (async () => {
      const built = await buildQueueSnapshots(db);
      if (built === null) return;
      io.to('clinic:queue:ops').emit('queue.snapshot', built.ops);
      io.to('clinic:queue:doctor').emit('queue.snapshot', built.doctor);
    })().catch((err: unknown) => {
      logger.warn('ws.queueSnapshot.emitFailed', { clinicDayId, err: String(err) });
    });
  });

  return {
    io,
    close(): void {
      setQueueSnapshotPublisher(null);
      io.close();
    },
  };
}
