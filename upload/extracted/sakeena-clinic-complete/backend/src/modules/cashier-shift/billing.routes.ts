import { Router, type NextFunction, type Request, type Response } from 'express';
import { authenticate, requireAuth, requireFreshPassword } from '../../common/middleware/authenticate.js';
import { requireRole } from '../../common/middleware/requireRole.js';
import { validate } from '../../common/middleware/validate.js';
import { idempotency } from '../../common/middleware/idempotency.js';
import { AppError } from '../../common/errors/AppError.js';
import {
  checkout,
  complimentary,
  getPatientBalance,
  getReceipt,
  listInvoices,
  listReceipts,
  payInvoice,
  reverseReceipt,
  settle,
  writeOffInvoice,
} from './billing.service.js';
import {
  checkoutSchema,
  complimentarySchema,
  invoicesQuerySchema,
  invoiceIdParamSchema,
  patientIdParamSchema,
  payInvoiceSchema,
  receiptIdParamSchema,
  receiptsQuerySchema,
  reverseSchema,
  settleSchema,
  writeOffSchema,
  type CheckoutInput,
  type ComplimentaryInput,
  type InvoicesQuery,
  type PayInvoiceInput,
  type ReceiptsQuery,
  type ReverseInput,
  type SettleInput,
  type WriteOffInput,
} from './billing.validators.js';

function readIdempotencyKey(req: Request): string {
  const raw = req.header('Idempotency-Key');
  if (raw === undefined || raw.trim().length === 0) {
    throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header (uuid v4) is required');
  }
  return raw.trim();
}

export const billingRouter: Router = Router();
billingRouter.use(authenticate, requireFreshPassword);

// GET /api/v1/billing?shiftId=&patientId=&status=&limit=&cursor=  [BOTH]
// -> 200 SecretSafe<InvoiceListDto> — operational-only financial projection.
billingRouter.get(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(invoicesQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    listInvoices(req.query as InvoicesQuery, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// POST /api/v1/billing/checkout  [BOTH]  -> 201 SecretSafe<CheckoutDto>
billingRouter.post(
  '/checkout',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('billing.checkout'),
  validate(checkoutSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    checkout(req.body as CheckoutInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(201).json(dto))
      .catch(next);
  },
);

// POST /api/v1/billing/complimentary  [DOCTOR]  -> 201 SecretSafe<ComplimentaryDto>
billingRouter.post(
  '/complimentary',
  requireRole('DOCTOR'),
  idempotency('billing.complimentary'),
  validate(complimentarySchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    complimentary(req.body as ComplimentaryInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(201).json(dto))
      .catch(next);
  },
);

// POST /api/v1/billing/invoices/:id/pay  [BOTH]  -> 201 SecretSafe<PayResultDto>
billingRouter.post(
  '/invoices/:id/pay',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('billing.pay'),
  validate(invoiceIdParamSchema, 'params'),
  validate(payInvoiceSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    payInvoice(params.id, req.body as PayInvoiceInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(201).json(dto))
      .catch(next);
  },
);

// POST /api/v1/billing/receipts/:id/reverse  [DOCTOR]  -> 201 SecretSafe<ReverseDto>
billingRouter.post(
  '/receipts/:id/reverse',
  requireRole('DOCTOR'),
  idempotency('billing.reverse'),
  validate(receiptIdParamSchema, 'params'),
  validate(reverseSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    reverseReceipt(params.id, req.body as ReverseInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(201).json(dto))
      .catch(next);
  },
);

// POST /api/v1/billing/invoices/:id/write-off  [DOCTOR]  -> 200 SecretSafe<WriteOffDto>
// RPS-2 DB-17. API_CONTRACTS.md lists write-off among the cash-critical POSTs
// that REQUIRE `Idempotency-Key: <uuid-v4>`, so the key is MANDATORY here
// exactly as it is for checkout/pay/reverse (C-7). A replay of the same key
// must return the original result with zero duplicate write-off rows.
billingRouter.post(
  '/invoices/:id/write-off',
  requireRole('DOCTOR'),
  idempotency('billing.writeOff'),
  validate(invoiceIdParamSchema, 'params'),
  validate(writeOffSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    writeOffInvoice(
      params.id,
      req.body as WriteOffInput,
      { userId: auth.userId, role: auth.role },
      readIdempotencyKey(req),
    )
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

export const receiptsRouter: Router = Router();
receiptsRouter.use(authenticate, requireFreshPassword);

// GET /api/v1/receipts?patientId=&shiftId=&invoiceId=  [BOTH]  -> 200 SecretSafe<ReceiptListDto>
receiptsRouter.get(
  '/',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(receiptsQuerySchema, 'query'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    listReceipts(req.query as ReceiptsQuery, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

// GET /api/v1/receipts/:id  [BOTH]  -> 200 SecretSafe<ReceiptDto>
receiptsRouter.get(
  '/:id',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(receiptIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    getReceipt(params.id, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);

export const patientSettleRouter: Router = Router();
patientSettleRouter.use(authenticate, requireFreshPassword);

// POST /api/v1/patients/:id/settle  [BOTH]  -> 201 SecretSafe<SettleDto>
// Mounted AFTER the identity patientRouter so it does not shadow patient routes.
patientSettleRouter.post(
  '/:id/settle',
  requireRole('DOCTOR', 'SECRETARY'),
  idempotency('billing.settle'),
  validate(patientIdParamSchema, 'params'),
  validate(settleSchema),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    settle(params.id, req.body as SettleInput, { userId: auth.userId, role: auth.role }, readIdempotencyKey(req))
      .then((dto) => res.status(201).json(dto))
      .catch(next);
  },
);

// GET /api/v1/patients/:id/balance  [BOTH]  -> 200 SecretSafe<PatientBalanceDto>
patientSettleRouter.get(
  '/:id/balance',
  requireRole('DOCTOR', 'SECRETARY'),
  validate(patientIdParamSchema, 'params'),
  (req: Request, res: Response, next: NextFunction): void => {
    const auth = requireAuth(req);
    const params = req.params as { id: string };
    getPatientBalance(params.id, { userId: auth.userId, role: auth.role })
      .then((dto) => res.status(200).json(dto))
      .catch(next);
  },
);
