# Frontend Architecture Specification — Psychiatric Practice Management System & Clinical AI Assistant

> **Document:** `docs/frontend/02_FRONTEND_ARCH_SPEC.md`
> **Phase:** Frontend Engineering Initiative — **Step 2: Technical Architecture Specification**
> **Status:** NORMATIVE FOR STEP 3+ (all frontend implementation must conform; deviations require an architecture amendment)
> **Predecessor:** `docs/frontend/01_DOMAIN_FEATURE_SYNTHESIS.md` — **APPROVED** (31 core S-01…S-18 / D-01…D-13, 10 deferred F-01…F-10, 2 excluded X-01/X-02, Gap Register GAP-01…GAP-11, principles P-01…P-12, mechanisms ZK-1…ZK-7, capabilities C-01…C-24)
> **Wire authorities (backend wins on wire behavior):**
>
> | # | Artifact | Revision consumed | Authority |
> |---|----------|------------------|-----------|
> | 1 | `docs/API_CONTRACTS.md` | RPS-2 applied, 223 lines, API-01…API-09 | REST DTOs, error envelope, idempotency scope, WS frames, RBAC tags |
> | 2 | `docs/DATABASE_SCHEMA_SPEC.md` | RPS-2 incl. §14 canon SQL + §15 INV-1…INV-10 | Severed-relation topology (DB-02), enums, derivation rules UI must never violate |
> | 3 | `docs/PROJECT_CONVENTIONS.md` | CONV-01…CONV-10, App. B/C/F | SecretSafe allowlist, lockShift/OCC/blind-close/floor/consent semantics, tripwire matrix mirrored here |
> | 4 | `docs/BACKEND_TASKS_WBS.md` | BE-101→702 | Integration sequencing constraint (§12) |
>
> **Operating constraint:** No application scaffolding (`ng new`) and no source code (`.ts`/`.html`/`.css`) in app directories was produced in this step. This document is specification only. Illustrative type/interface sketches below are **contracts, not implementation** — Step 3 implementers must realize them file-for-file.
> **Mirror:** this file is mirrored verbatim to `D:\Clinic-front\docs\frontend\02_FRONTEND_ARCH_SPEC.md` (frontend working repo). The `D:\Clinic` copy is the record of authority; any divergence is resolved in favor of `D:\Clinic`.
> **Conformance language:** MUST / MUST NOT = blocking; SHOULD = strong default with recorded justification; MAY = permitted option.

---

## Table of Contents

- [0. How to Read This Spec](#0-how-to-read-this-spec)
- [1. Core Framework & Engine Foundations](#1-core-framework--engine-foundations)
- [2. Reactivity & State Architecture (Signal-First)](#2-reactivity--state-architecture-signal-first)
- [3. HTTP Networking, Interceptors & Resilience](#3-http-networking-interceptors--resilience)
- [4. Real-Time WebSocket Gateway Architecture](#4-real-time-websocket-gateway-architecture)
- [5. Routing, Security Guards & Zero-Knowledge Isolation](#5-routing-security-guards--zero-knowledge-isolation)
- [6. CSS Architecture & Bidirectional Logical Properties](#6-css-architecture--bidirectional-logical-properties)
- [7. Project Topology, Naming & Dependency Rules](#7-project-topology-naming--dependency-rules)
- [8. Domain Models, DTOs & Validation](#8-domain-models-dtos--validation)
- [9. Forms, Money, Time & Rendering Rules](#9-forms-money-time--rendering-rules)
- [10. Security, Privacy & Vault Hygiene](#10-security-privacy--vault-hygiene)
- [11. UX Shells: Toasts, Dialogs, Command Palette, Offline](#11-ux-shells-toasts-dialogs-command-palette-offline)
- [12. Build, Environments, Budgets & CI Gates](#12-build-environments-budgets--ci-gates)
- [13. Test Strategy & Frontend Tripwire Mirror](#13-test-strategy--frontend-tripwire-mirror)
- [14. Step-1 Decision Register (§6.2 Resolved) & Gap Disposition](#14-step-1-decision-register-62-resolved--gap-disposition)
- [15. Traceability Matrices](#15-traceability-matrices)
- [16. Step-3 Entry Criteria & Build Order](#16-step-3-entry-criteria--build-order)
- [Appendix A — Canonical Route Tree (normative)](#appendix-a--canonical-route-tree-normative)
- [Appendix B — Interceptor Chain Order & Idempotency Route Table](#appendix-b--interceptor-chain-order--idempotency-route-table)
- [Appendix C — Error Catalogue Binding (normative)](#appendix-c--error-catalogue-binding-normative)
- [Appendix D — Glossary](#appendix-d--glossary)

---

## 0. How to Read This Spec

0.1 **Normative skeleton.** §§1–6 are the six mandated sections; §§7–16 make the spec buildable and testable. Appendices A–C are normative reference tables implementers MUST encode literally (route paths, interceptor order, error-code behavior).

0.2 **Step-1 linkage.** Every `S-*`/`D-*` feature, `C-*` capability, `P-*` principle, `ZK-*` mechanism, `GAP-*` gap, and `INV-*` invariant from Step 1 is bound to an architectural mechanism here (§15). If a Step-1 item has no binding, the spec is incomplete — file a spec defect, do not invent behavior.

0.3 **Wire precedence.** Where this spec and a backend contract disagree on wire shape, headers, status codes, or RBAC, the backend contract wins and the discrepancy MUST be logged as a new `GAP-*` entry. This spec MUST NOT silently extend the wire (no new endpoints, no new headers, no `?include=clinical`).

0.4 **No-code rule.** Code fences in this spec denote **shape contracts** (types, interfaces, route tables, header tables) for Step-3 realization. They are not checked-in source and MUST NOT be construed as scaffolding.

---

## 1. Core Framework & Engine Foundations

### 1.1 Framework pin

| Decision | Normative value | Rationale / trace |
|----------|-----------------|-------------------|
| Framework | **Angular 19 LTS or 20 LTS** (latest LTS at Step-3 kickoff; single major for the whole Phase 1) | Standalone-first, signals-first, zoneless-ready, functional interceptors/guards, `resource`/`httpResource` maturity |
| Language | **TypeScript ~5.6+** (whatever the chosen Angular LTS requires), **strict family ON** (§1.3) | Matches backend `PROJECT_CONVENTIONS.md` §1 strictness; zero-`any` parity |
| Rendering | Client-side rendered SPA; no SSR/SSG in Phase 1 (excluded X-02 forbids public web; scribe/vault ephemerality forbids server-side clinical caching) | ZK-6, C-15 |
| Builder | Angular application builder (esbuild + Vite dev-server) | Build budgets enforced (§12) |
| Package manager | npm + `package-lock.json` committed; `engines: node >= 20` | Parity with backend Node v20+ LTS |

> **SPEC-1.1:** Step 3 MUST record the exact resolved `angular@x.y.z` / `typescript@x.y.z` in this section as an amendment note before writing any component. Mixed majors are forbidden.

### 1.2 Component paradigm — 100% standalone, zero NgModule

**SPEC-1.2.1 — Standalone mandate.** Every component, directive, and pipe MUST be standalone:

```ts
// CONTRACT SHAPE (illustrative) — every component follows this skeleton
@Component({
  selector: 'app-ops-waiting-room-board',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, RouterModule /* + exactly the child standalone units used */],
  templateUrl: './ops-waiting-room-board.component.html',
  styleUrl: './ops-waiting-room-board.component.scss',
})
export class OpsWaitingRoomBoardComponent { /* presentation only; state via injected stores */ }
```

**SPEC-1.2.2 — Banned constructs.** `NgModule`, `@NgModule`, `BrowserModule`, `CommonModule`-via-module, `RouterModule.forRoot/forChild` (use `provideRouter`), `HttpClientModule` (use `provideHttpClient`), barrel `SharedModule` that re-exports everything — all FORBIDDEN. Routing uses `loadChildren`/`loadComponent` exclusively (§5). Violation fails lint (`no-ngmodule` custom rule, §12).

**SPEC-1.2.3 — Composition rule.** Feature surfaces compose from standalone presentational units (`ui-*`) + container components that inject stores. Containers fetch/mutate; presentational units receive `@Input()` (immutable snapshots) and emit `@Output()` (user intents). No presentational unit may inject `HttpClient`, `SocketService`, `OpsApi`, or `ClinicalApi` directly.

**SPEC-1.2.4 — Bootstrap contract.** Application boots exclusively via:

```ts
// CONTRACT SHAPE — src/main.ts
bootstrapApplication(AppComponent, {
  providers: [
    provideRouter(APP_ROUTES),
    provideHttpClient(withInterceptors([authInterceptor, refreshTokenInterceptor, idempotencyInterceptor, errorEnvelopeInterceptor, occVersionInterceptor])),
    provideAnimationsAsync(),
    /* store + gateway providers per §2/§4 scoping rules */
  ],
});
```

### 1.3 Change detection — zoneless-ready, OnPush mandatory

**SPEC-1.3.1 — OnPush everywhere.** `ChangeDetectionStrategy.OnPush` is mandatory on **every** `@Component`. Default-CD components fail lint (`@angular-eslint/prefer-on-push: error`).

**SPEC-1.3.2 — Zoneless-ready.** All components, stores, and services MUST be correct under both zoneful and zoneless runtimes:

1. No reliance on `setTimeout`/`Promise.then` triggering CD implicitly — state changes flow through `signal.set/update` or `Observable → toSignal` boundaries.
2. No `ApplicationRef.tick()` / `ChangeDetectorRef.detectChanges()` in product code (allowed only inside test harnesses with a comment citing the test).
3. `effect()` used only inside injection contexts per §2.3; never for rendering.
4. Step 3 SHOULD enable `provideZonelessChangeDetection()` behind a feature flag after the smoke suite passes, and MUST record the outcome here. Phase-1 ship MAY remain zoneful, but zoneless-incompatible code MUST NOT ship.

**SPEC-1.3.3 — Input discipline.** Component inputs MUST be `input()` signal inputs (or `input.required<T>()`) — legacy `@Input()` decorator is forbidden in new code. All inputs are treated as immutable; mutation of an input object is a defect.

### 1.4 TypeScript configuration — strict family + zero `any`

**SPEC-1.4.1 — Normative `tsconfig` base** (Step 3 writes this verbatim, adjusting only `target` upward with the Angular LTS):

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "dom", "dom.iterable"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "useDefineForClassFields": true,
    "experimentalDecorators": true
  },
  "angularCompilerOptions": {
    "strictTemplates": true,
    "strictInputAccessModifiers": true,
    "strictNullInputTypes": true,
    "strictAttributeTypes": true,
    "strictDomEventTypes": true,
    "strictDomStructuralTyping": true
  }
}
```

**SPEC-1.4.2 — Zero-`any` policy.** `@typescript-eslint/no-explicit-any: error`. Untyped boundaries (WebSocket payloads, `localStorage` reads, error bodies) are typed `unknown` and narrowed via Zod-equivalent runtime guards (§8) before use. `as any` / `<any>` fails CI. The only permitted escape hatch is `as unknown as T` with a preceding runtime-guard call and a comment citing the guard — reviewers MUST reject unguarded casts.

**SPEC-1.4.3 — Exact-optionals consequence.** With `exactOptionalPropertyTypes`, optional DTO fields MUST be modeled as `field?: T | undefined` explicitly where "absent" differs from "null" (e.g., `discountReason?: string | null`). Assigning `undefined` to a non-optional field is a type error — this is intentional and protects P-06 explicitness (missing vs `NOT_PERFORMED` vs empty string are three distinct states).

### 1.5 Angular feature allowlist / banlist

| Allowed (prefer) | Banned in Phase 1 | Why |
|---|---|---|
| Standalone components, `input()`/`output()`/`model()`, `inject()`, `signal`/`computed`/`effect`/`resource`, `toSignal`/`toObservable`, functional guards/interceptors, `httpResource`, deferred views (`@defer`) | `NgModule`, class guards/interceptors, `NgRx`/`NgXs`/`Akita`, `@angular/http` legacy, `entryComponents`, `APP_INITIALIZER` doing authenticated fetches (use functional `appInitializer` + session restore, §10) | Signal-first reactivity (§2); RxJS containment (§2.4); ZK bundle control (§5.4) |
| Typed Reactive Forms (`FormGroup<T>`, `FormRecord`) | Template-driven `ngModel` forms for anything except trivial search boxes | P-06 explicit validation needs typed forms (§9) |
| `AsyncPipe` only at interop edges (search box → `toSignal`) | Manual `.subscribe()` in components | RxJS containment (§2.4) |

---

## 2. Reactivity & State Architecture (Signal-First)

### 2.1 Doctrine

**SPEC-2.1.1 — Signals own all synchronous UI state.** Every piece of rendered state (queue list, shift status, invoice totals, form validity, scribe phase, intercom feed) MUST be derived from `signal()` / `computed()` graphs living in **domain stores**. Components read signals; they never hold authoritative copies.

**SPEC-2.1.2 — RxJS is quarantined.** RxJS exists only inside the three pipelines named in §2.4. Any other `.subscribe()`, `Subject`, or operator import outside `core/rx-boundary/` and the named pipelines fails lint (`no-rxjs-outside-boundary`).

**SPEC-2.1.3 — Server is the authority (P-01).** Stores are optimistic renderers over versioned server snapshots. Every mutation is provisional until the versioned REST response or the confirming WS frame lands. Stores MUST retain `serverAt` + `queueVersion` alongside data (P-09 staleness badges).

### 2.2 Domain store pattern (normative catalogue)

**SPEC-2.2.1 — Store shape contract.** All stores are `providedIn: 'root'` (except `VaultHolder` and `ConsultationStore`, doctor-scoped — §5.5) injectable classes exposing **readonly signals**, **computed views**, and **intent methods** (no public writable signals):

```ts
// CONTRACT SHAPE — every store follows this skeleton
@Injectable({ providedIn: 'root' })
export class QueueStore {
  private readonly _entries = signal<OpsQueueEntry[]>([]);
  private readonly _queueVersion = signal<number>(-1);
  private readonly _serverAt = signal<string | null>(null);

  readonly entries = this._entries.asReadonly();
  readonly queueVersion = this._queueVersion.asReadonly();
  readonly waitingCount = computed(() => this._entries().filter(e => e.status === 'WAITING').length);

  applySnapshot(snap: QueueSnapshot): void { /* version-gated replace, §4.4 */ }
  applyOptimisticReorder(ids: string[]): void { /* ghost only, §3.5 */ }
  revertToSnapshot(snap: QueueSnapshot): void { /* 409 snap-back */ }
}
```

**SPEC-2.2.2 — Mandatory store catalogue.** Step 3 MUST implement exactly these stores (no merges, no splits without amendment):

| Store | Scope | Signals (authoritative) | Key computed views | Intent methods (each maps to §15 endpoint) | Persistence |
|---|---|---|---|---|---|
| `AuthStore` | root | `session: SessionState` (`ANONYMOUS\|AUTHENTICATED`), `me: CurrentUser\|null`, `lastRefreshAt` | `role()`, `isDoctor()`, `isSecretary()`, `isAuthenticated()` | `restore()`, `login()`, `logout(failClosed)`, `handleDeactivated()` | `me` in memory only; refresh token is httpOnly cookie (never JS-readable); no session in `localStorage` |
| `SettingsStore` | root | `settings: ClinicSettings\|null` (`standardFeeMinor`, `currency`, `avgConsultDurationMin`, `secretaryMaxDiscountMinor/Pct`, `audioRetentionDays`) | `currencyFormatter()`, `floorMeterFor(fee)` | `load()` (GET /settings, both roles) | memory only |
| `QueueStore` | root | `entries`, `queueVersion`, `serverAt`, `avgConsultDurationMin`, `pendingIntent: ReorderIntent\|null` | `waiting()`, `activeConsult()`, `headWaitMin()`, `isStale()` | `loadSnapshot()`, `reorder()`, `flagEmergency()`, `checkIn()`, `callNext/skip/requeue/complete/undoComplete` (role-gated) | `queueVersion` + last snapshot meta in `sessionStorage` for reconnect resync; entries NOT persisted across reload (refetch authoritative) |
| `ShiftStore` | root | `currentShift: OpsShift\|null`, `summary: ShiftSummary\|null` (blind-aware type — NO expected field pre-close) | `isOpen()`, `canAttemptClose()` (openEntries===0), `postCloseResult()` | `open()`, `loadSummary()`, `closeBlind(actualCountedMinor)`, `forceCloseWithReason()` (doctor) | shift id in `sessionStorage`; `actualCountedMinor` draft NEVER persisted (re-entry required after reload) |
| `BillingStore` | root | `invoices: Map<invoiceId, OpsInvoice>`, `receipts: Map<receiptId, OpsReceipt>`, `balanceByPatient: Map<patientId, PatientBalance>` | `outstandingFor(patientId)`, `oldestFirstLines(patientId)` (C-07) | `checkout()`, `payInvoice()`, `reverseReceipt()` (doctor), `writeOff()` (doctor), `allocateOldestFirst()` orchestrator | idempotency outbox persisted (§2.5); financial rows NOT cached across logout |
| `IntercomStore` | root | `messages: IntercomMsg[]`, `unreadCount`, `directiveReceipts: Map<msgId, EffectReceipt>` | `directives()`, `operationalNotices()` | `send()`, `applyReceived()`, `markRead()` | history pagination cursor in memory; no pre-fill from clinical (§ZK-5) |
| `FollowUpStore` | root | `tasks: FollowUpTask[]` | `byStatus()` | `load()`, `transition()` | memory only |
| `SupervisionStore` | doctor scope | `activity`, `cashSummary+auditCoverage`, `discrepancies`, `readiness: ShiftReadiness\|null` | `blockers()`, `canClose()` | `refreshAll()` (D-01) | memory only; never exposed to secretary injector |
| `ConsultationStore` | doctor scope | `activeEntryId`, `encounterDraft: ClinicalEncounterDraft\|null`, `signedChart: SignedEncounter[]` | `isDraftDirty()`, `unsignedBacklog()` (GAP-02 local roster) | `startManual()`, `patchDraft()`, `sign()`, `appendAddendum()` | drafts in MEMORY ONLY (C-18 forbids disk persistence of clinical drafts) |
| `ScribeStore` | doctor scope | `session`, `cycle1Draft`, `cycle2Draft`, `audioBlob` (bounded 15 MB memory only) | `consentState()`, `retentionUntil`, `canCommit`, `isLocked` | `createSession()`, `setAudio()`, `runCycle1Analyze()`, `runCycle2Synthesis()`, `patchCycle2Soap()` (local), `commitScribeSession()`, `withdrawConsent()`, `purgeAudio()`, `startNewSession()` | Gen-2 canonical intents (Decision 4); audio inline per cycle; corrections land at commit |
| `MedicationStore` | doctor scope | `medsByPatient: Map<patientId, Medication[]>` | `active()`, `discontinued()`, `overlapAdvisories()` (C-22 advisory) | `create()`, `discontinue()`, `titrateSaga()` (§8.6) | memory only |
| `VaultHolder` | doctor scope, **ephemeral** | `plaintextByNote: Map<noteId, string>` (plaintext ONLY here) | `isOpen()` | `writeNote()`, `readEphemeral()`, `scrub(reason)` | NEVER persisted; scrub triggers §10.4 |
| `OutboxStore` | root | `pending: IdempotencyRecord[]` (`key`, `route`, `payloadHash`, `entityId`, `shiftId`, `createdAt`, `state`) | `pendingFor(entity)` | `mint()`, `markReplied()`, `markTerminal()` | **persisted `localStorage` `clinic.outbox.v1`** (§2.5) — Ops payloads only, never clinical |

**SPEC-2.2.3 — Forbidden stores.** No `ClinicalStore` god-object, no shared `PatientCardStore` joining Ops+Clinical for the same patient (ZK-4). Any component rendering both an Ops balance and a clinical chart MUST inject two stores and render two visually disjoint panels with separate loading/error states.

### 2.3 Reactive primitives — explicit rules

| Primitive | Permitted use | Forbidden use |
|---|---|---|
| `signal()` | All mutable domain state inside stores; local UI ephemera (dialog open, drawer tab) inside components via `signal()` | Writable signals exposed publicly (must be `.asReadonly()`); signals holding floats for money (minor-unit integers only, §9.2) |
| `computed()` | All derived views (counts, totals from server-provided numbers, filtered lanes, floor-meter math, oldest-first ordering) — MUST be pure, synchronous, total (no throw on empty) | Async work, HTTP, or WS inside `computed()`; `computed()` that reads `localStorage`/DOM |
| `effect()` | ONLY inside stores/services for cross-cutting side-effects: (a) outbox persistence, (b) vault scrub timers, (c) staleness-badge clocks, (d) audit-notice logging. MUST declare `allowSignalWrites` explicitly where needed and MUST be created in an injection context | `effect()` in components for data-fetching or rendering; `effect()` that performs HTTP mutations; effects that write the signal they read (cycle) without an `untracked()` guard |
| `resource` / `httpResource` (Angular) | Read-only server snapshots bound to a signal input (chart page by patientId, balance panel by patientId, summary by shiftId) | Mutations through `resource`; clinical `resource` inside secretary subtree (§5.5) |
| `toSignal` / `toObservable` | ONLY at the three RxJS boundary exits (§2.4): search-box stream, WS message stream, HTTP pipeline stream → signal | General component subscription plumbing |

**SPEC-2.3.1 — `effect()` review gate.** Every `effect()` MUST carry a one-line comment `// EFFECT-N: <purpose> — writes: <signals> — trigger: <signals>` and be listed in the store's header doc. Unlisted effects fail review.

### 2.4 RxJS boundaries — strict containment

RxJS is permitted in **exactly three** pipelines, each isolated in its own file under `core/rx-boundary/` and each terminating in `toSignal()` at the store edge. Zero RxJS in presentational components.

| # | Pipeline | Operators allowed | Entry → Exit | Notes |
|---|---|---|---|---|
| R-1 | **Search-input debounce** (`OpsCheckInDialog`, registration duplicate check) | `debounceTime(250–350ms)`, `distinctUntilChanged`, `switchMap`, `catchError`, `takeUntilDestroyed` | `FormControl.valueChanges` → `toSignal<SearchResult[]>` | C-17. `switchMap` cancels in-flight; empty query emits `[]` without HTTP. Keyboard navigation stays signal-driven |
| R-2 | **WebSocket message ingestion** | `fromEvent`/`Subject` bridge, `filter` (frame-type), `retry` ONLY for socket re-subscription (not data retry), `takeUntilDestroyed` | socket `onAny` → validated `unknown` → Zod guard → store `apply*` | Raw frames NEVER reach components; §4.4 version gate lives here |
| R-3 | **HTTP request/response pipelines** | `switchMap`/`concatMap` (orchestration, e.g., oldest-first sequential pays C-07), `retry` ONLY for `409 SHIFT_LOCKED` bounded backoff (§3.6), `catchError` → error-catalogue mapping (§3.7) | intent method → `HttpClient` → `toSignal`-compatible promise (`firstValueFrom`) or direct subscribe-inside-store | Components call `async` intent methods returning `Promise<Result>`; they never see `Observable` |

**SPEC-2.4.1 — Import lint.** `rxjs` and `rxjs/operators` imports are allowed only in: `core/rx-boundary/**`, `core/net/**` (interceptors use `catchError`/`switchMap`/`throwError` for refresh replay), `core/realtime/socket.service.ts`, and store files for the three pipelines. All other files importing RxJS fail CI.

**SPEC-2.4.2 — No-leak rule.** `Subject` instances MUST NOT be exposed publicly; pipeline outputs cross the boundary as signals or promises. `BehaviorSubject` as state is forbidden (use `signal`).

### 2.5 Idempotency outbox (C-05) — client durability without double-spend

**SPEC-2.5.1 — Key lifecycle.** (1) Mint UUIDv4 at **user-intent time** (dialog confirm click), not at retry time. (2) Persist `{key, route, payloadHash (SHA-256 of canonical JSON), entityId, shiftId, createdAt, state: PENDING}` to `OutboxStore` (localStorage) BEFORE dispatch. (3) Attach as `Idempotency-Key` header (§3.4). (4) On terminal `2xx` (including `Idempotent-Replayed: true`) → `markReplied` + remove. (5) On `422 IDEMPOTENCY_KEY_REUSE` → `markTerminal` + hard-stop UX (fresh intent required). (6) On transport failure / `409 SHIFT_LOCKED` (bounded retry, §3.6) → retain PENDING and offer resume-on-reload ("1 unsent payment — Resume / Discard").

**SPEC-2.5.2 — Scope key.** Outbox rows keyed by `(route, entityId, shiftId)`; resuming with a different payload hash under the same key is forbidden (would trip server `REUSE`) — resume replays the stored payload hash exactly or mints a new key for edited payloads.

**SPEC-2.5.3 — Hygiene.** Outbox holds Ops payloads only (checkout/pay/reverse/write-off/petty/close/check-in/complimentary-directive). Clinical payloads (SOAP/MSE/vault/scribe) MUST NEVER enter the outbox (C-18). Outbox cleared on logout except PENDING money intents, which survive logout and are offered for resume after re-login (same actor+shift scope check).

---

## 3. HTTP Networking, Interceptors & Resilience

### 3.1 Client foundation

**SPEC-3.1.1 — Base configuration.** Single `API_BASE = /api/v1` (relative; environment files supply only host override for dev proxy). All requests set `Accept: application/json`. Mutating JSON requests set `Content-Type: application/json`. Timeouts: default 15 s via `AbortSignal.timeout` wrapper in `core/net/http-timeout.ts`; scribe audio travels inline as base64 JSON (≤15 MB body limit opt-in).

**SPEC-3.1.2 — Two-facade rule (ZK-3).** The API client exposes exactly two injectable facades:

```ts
// CONTRACT SHAPE
@Injectable({ providedIn: 'root' }) export class OpsApi {
  /* queue, billing, shifts, receipts, intercom, patient identity, followups, supervision-safe subsets, settings, auth */
}
@Injectable({ providedIn: 'root' }) export class ClinicalApi {
  /* EHR encounters/chart/meds/vault/scribe — provided ONLY in doctor subtree (§5.5) */
}
```

`ClinicalApi` MUST be provided at the `cockpit` route level (`providers: [ClinicalApi, ConsultationStore, ScribeStore, …]`), NOT root. Secretary-subtree resolution of `ClinicalApi` MUST throw (verified by DI test, §13). Both facades return **typed promises** (`firstValueFrom` internally) — no `Observable` leaks to components.

**SPEC-3.1.3 — Money/time transport.** All money fields are integers in minor units end-to-end; the `Money` branded type (`type Minor = number & { readonly __minor: unique symbol }`) is used in all DTOs. Dates are ISO-8601 UTC strings on the wire; conversion to local display happens at the view edge (§9.3).

### 3.2 Functional interceptor chain (normative order)

Chain order is load-bearing (Appendix B). Step 3 MUST register exactly:

```
1. authInterceptor → 2. occVersionInterceptor → 3. idempotencyInterceptor → 4. refreshTokenInterceptor → 5. errorEnvelopeInterceptor
```

(expressed as `withInterceptors([...])` in that array order; Angular executes in registration order for outgoing requests).

| # | Interceptor | Responsibility | Normative behavior |
|---|---|---|---|
| 1 | `authInterceptor` | Attach Bearer access JWT to all `/api/v1/*` except allowlisted public routes | Reads token from in-memory `AuthStore` (never `localStorage`). Skips `POST /auth/login`, `POST /auth/refresh`, `GET /health`. On missing token for a protected route, short-circuits to `AuthStore.logout()` redirect (no unauthenticated dispatch) |
| 2 | `occVersionInterceptor` | Attach OCC version to queue-governed routes | For `POST /queue/reorder` and `POST /queue/:id/emergency`: reads `QueueStore.queueVersion()` and sets BOTH `If-Match: <v>` header AND ensures body `expectedQueueVersion === v` (reorder). If store version is `-1` (no snapshot yet), blocks dispatch and forces `loadSnapshot()` first. Mismatch between header/body is a client defect — throw before send |
| 3 | `idempotencyInterceptor` | Mint-or-attach `Idempotency-Key` on the route table (Appendix B) | If caller already supplied a key (outbox resume), reuses it. Else mints UUIDv4, records in `OutboxStore.mint()`, sets header. Never reuses a key across different payload hashes. On `422 IDEMPOTENCY_KEY_REQUIRED` response (server claims missing), retries ONCE with a fresh key |
| 4 | `refreshTokenInterceptor` | Single-flight 401 recovery via `/auth/refresh` (httpOnly cookie) | On 401 from a protected route: queues concurrent requests; first 401 triggers exactly one refresh call; success → replay queued with new Bearer; refresh-family failure (401 on refresh, 403 deactivated) → fail-closed `AuthStore.logout()` + redirect to `/login?reason=session` + WS disconnect. Non-idempotent replay safety: replayed requests reuse their ORIGINAL `Idempotency-Key` (never mint new on replay) |
| 5 | `errorEnvelopeInterceptor` | Normalize `{error:{code,message,details}}` into typed `AppError` + dispatch UX | Maps every backend code per Appendix C; emits toast/dialog/converge action; attaches `correlationId`/`incidentId` where present; unknown codes → safe generic. MUST NOT retry terminal codes |

**SPEC-3.2.1 — Interceptor purity.** Interceptors MUST NOT contain domain logic (no floor math, no oldest-first, no vault handling). They are transport envelopes only; domain mapping lives in stores/facades.

### 3.3 Auth & refresh detail

- Access JWT lifetime ~15 min (server-owned). Client proactively refreshes at 80% lifetime via a silent timer (C-24) AND reactively on 401 (single-flight). Refresh uses `POST /auth/refresh` with credentials cookie (`withCredentials: true`); the refresh endpoint is EXCLUDED from `authInterceptor` Bearer attachment.
- Concurrent-401 queue: implementation holds a `Promise<string|null>` single-flight slot; queued requests await it; timeout 10 s then fail-closed logout (never hang the UI).
- Deactivation (`403` with deactivated semantics, or 401-family on refresh): immediate lockout — clear stores (incl. `VaultHolder.scrub('deactivated')`), disconnect WS, redirect login, toast "Account deactivated — contact the doctor." No retry of authenticated calls afterward (C-24).

### 3.4 Idempotency detail (wire: `Idempotency-Key: <uuid-v4>`)

Covered routes (normative, from API Part 0): `POST /billing/checkout`, `POST /billing/invoices/:id/pay`, `POST /billing/receipts/:id/reverse`, `POST /billing/invoices/:id/write-off`, `POST /shifts/:id/petty`, `POST /shifts/:id/close`, `POST /queue/check-in`, `POST /intercom` **iff** `type === DOCTOR_COMPLIMENTARY` (REST and WS alike — WS path mints the key client-side and includes `idempotencyKey` in the payload).

Client rules: mint-at-intent (§2.5); replay `200 + Idempotent-Replayed: true` treated as **success** (reconcile to returned original, single success toast, no double navigation); `422 IDEMPOTENCY_KEY_REUSE` is terminal (fresh intent + new key required); keys scoped per `(actor, shift, entity)` — cross-shift reuse forbidden.

### 3.5 OCC collision protocol (409 STALE_QUEUE / STALE_ROW_VERSION)

**SPEC-3.5.1 — STALE_QUEUE handling (queue reorder/emergency/check-in races).** On `409` with code `STALE_QUEUE` (response carries current snapshot):

1. `QueueStore.revertToSnapshot(attachedSnapshot)` — snap back optimistic ghost, no animation masking the snap.
2. Toast (warning, non-blocking): "Queue changed under you (v{old} → v{new}). Review and retry." with action "Review board" focusing the changed rows.
3. NEVER auto-retry the user's drag/flag with the new version (C-01). The user re-issues intent explicitly (new `If-Match` + SAME `Idempotency-Key` is permitted for reorder retry — same payload; new key only if payload changed).

**SPEC-3.5.2 — Encounter currency (GAP-01 correction).** The client MUST NOT send `If-Match` on any `/ehr/*` or `/scribe/*` route. Currency conflicts surface as `409 already SIGNED` / `400 SIGNED` / draft version-mismatch → handler reloads the encounter and routes further edits to an addendum (`POST …/append`), never to a forced PATCH.

**SPEC-3.5.3 — SHIFT_LOCKED (409) handling.** Bounded retry with SAME `Idempotency-Key` + exponential backoff (3 attempts: 250 ms, 750 ms, 2 s) for checkout/pay/petty/close. After exhaustion, toast "Drawer busy — safe to retry (same receipt key held)" with explicit Retry button (reuses key). Lock contention is never surfaced as a data error.

### 3.6 Resilience & timeout policy

| Scenario | Policy |
|---|---|
| Transport failure (0/timeout) on idempotent money routes | Retain outbox PENDING; toast "Unsent — will resume" with Resume action; exponential backoff auto-retry ×3 only if payload hash unchanged |
| Transport failure on non-money routes | Single manual Retry affordance; no auto-retry loops |
| `500 INTERNAL + incidentId` | Safe generic message + incident id + "Report" affordance (copies id, no clinical payload in report); log correlation id |
| Slow responses > 8 s | Non-blocking skeleton + cancel affordance; abort at 15 s (120 s audio) with retry |

### 3.7 Error-envelope normalization (summary; Appendix C normative)

`errorEnvelopeInterceptor` parses `{error:{code,message,details}}` into `AppError{code, httpStatus, fieldErrors, expected, incidentId, replayed}`. Field-level `details[]` route to form controls (`discountReason`, MSE selectors, petty `purpose`, emergency `reason`); blocking dialogs for `INVARIANT_VIOLATION`/`FLOOR_VIOLATION`/`WITHDRAWN_GONE`; silent convergence for `ILLEGAL_TRANSITION` (refetch snapshot); fail-closed logout for auth codes. Toast copy MUST never include clinical content, vault plaintext, expected-cash values, or full SOAP text (ZK-7).

---

## 4. Real-Time WebSocket Gateway Architecture

### 4.1 Singleton `SocketService` — lifecycle, handshake, rooms, heartbeat

**SPEC-4.1.1 — Singleton + transport.** One `SocketService` (`providedIn: 'root'`, lazy-connect on first authenticated session). Built on `socket.io-client` v4, `transports: ['websocket']` primary with `polling` fallback, `withCredentials: true`, `auth: { token: <accessJWT> }` handshake. Invalid token → `connect_error(401)` → trigger refresh-once then reconnect; deactivated → `403` → fail-closed logout incl. WS teardown (C-24).

**SPEC-4.1.2 — Room subscriptions.** On connect, emit `queue.subscribe { shiftId }` (current shift from `ShiftStore`) for the queue snapshot handshake, and join role rooms server-side: `clinic:queue` + `clinic:intercom` (both roles); `supervision.discrepancy` room is doctor-only (server enforces; client MUST NOT subscribe as secretary — and the secretary bundle MUST NOT contain the handler, §5.4).

**SPEC-4.1.3 — Heartbeat & presence.** Client heartbeat `ping` every 25 s; server `pong` timeout 10 s → mark `linkState: DEGRADED` (staleness badge, §4.5). Authenticated presence re-announced on every reconnect with fresh Bearer.

**SPEC-4.1.4 — Lifecycle states.** `DISCONNECTED → CONNECTING → LIVE → DEGRADED → RECONNECTING → LIVE`. All states exposed as a `linkState` signal consumed by staleness badges. Transitions logged (ids + versions only, no clinical).

### 4.2 Snapshot ingestion — `queue.snapshot` discipline (wire: `queue.updated`)

**SPEC-4.2.1 — Authoritative snapshot rule.** The `queue.updated` frame (`{queueVersion, shiftId, avgConsultDurationMin, serverAt, entries[]}` SecretSafe) is the ONLY writer of queue order/positions/wait times. Initial bootstrap ALSO fetches `GET /queue` (REST snapshot) then converges to WS frames. No other frame mutates order.

**SPEC-4.2.2 — Ingestion pipeline** (`core/realtime/queue-ingest.ts`, RxJS boundary R-2):

```
socket.onAny → raw unknown → Zod-guard per frame type → version-gate (§4.4) → store.apply* → derived computed refresh → (doctor-only) supervision/discrepancy side-channel
```

Frame routing table:

| Frame | Handler | Store write |
|---|---|---|
| `queue.updated` | `QueueStore.applySnapshot` (full replace) | entries + queueVersion + serverAt |
| `queue.called` / `queue.reordered` / `queue.emergency` / `queue.undoComplete` | version-check then `QueueStore.applySnapshot` if `queueVersion` jumped, else targeted patch + version bump | version-gated (§4.4) |
| `billing.invoiceUpdated` | `BillingStore.applyInvoiceTotals` (totals only: status/collected/outstanding) | invoice map patch |
| `intercom.received` | `IntercomStore.applyReceived` + effect-receipt enrichment (invoice id / task id / queueVersion) | message append |
| `supervision.discrepancy` | `SupervisionStore.applyDiscrepancy` (doctor injector ONLY) | discrepancy alert (non-blocking) |

**SPEC-4.2.3 — Shape fidelity.** Ingestion transforms backend shapes DIRECTLY into `QueueStore` signals with no intermediate normalization cache: `entries[]` order = render order; `position` rendered, never recomputed; `estimatedWaitMin` rendered, never recomputed (P-09/C-20). Any client-side sorting is display-grouping over the authoritative array (e.g., lane grouping preserves `position` order within lanes).

### 4.3 Resilient reconnection — exponential backoff + resync

**SPEC-4.3.1 — Backoff schedule.** Reconnect attempts with jittered exponential backoff: 500 ms → 1 s → 2 s → 5 s → 15 s (cap), reset on LIVE. Each reconnect replays: (1) fresh Bearer via `AuthStore`, (2) `queue.subscribe {shiftId}` → immediate `queue.updated` snapshot, (3) `BillingStore` resync of open invoices for visible patients, (4) `IntercomStore` history gap-fill from last `createdAt` cursor.

**SPEC-4.3.2 — Convergence target.** Board convergence on reconnect < 1 s on broadband (measured in perf smoke, §12). During partition, surfaces show staleness badges with last `serverAt`/`queueVersion` and fall back to REST snapshots on a 15 s poll cadence (P-09). The client MUST NEVER extrapolate queue positions or balances while disconnected (C-09).

### 4.4 Version monotonicity guard (normative)

```ts
// CONTRACT SHAPE — applied to every queue-versioned frame
function gateFrameVersion(frame: { queueVersion: number }, store: QueueStore): 'apply' | 'drop-stale' | 'resync' {
  const cur = store.queueVersion();
  if (frame.queueVersion <= cur) return 'drop-stale';   // stale/duplicate: drop after snapshot check
  if (frame.queueVersion === cur + 1) return 'apply';   // contiguous: targeted apply
  return 'resync'; // jump: GET /queue snapshot resync, then apply
}
```

`resync` path MUST fetch REST snapshot and replace; targeted deltas MUST NOT be applied across a version jump (avoids ghost order).

### 4.5 Degradation UX contract

| Link state | Board UX | Billing UX | Intercom UX |
|---|---|---|---|
| LIVE | live badge (subtle), no banner | normal | normal |
| DEGRADED / RECONNECTING | amber "Offline — showing last confirmed queue v{N} · {serverAt}" + disabled DnD (reorder requires LIVE) + 15 s REST poll | mutations allowed (outbox-backed) with "will confirm" chip | send allowed (queued), history gap-filled on LIVE |
| DISCONNECTED (post-logout) | board unmounted, login redirect | outbox PENDING retained for resume | unmounted |

---

## 5. Routing, Security Guards & Zero-Knowledge Isolation

### 5.1 Route tree & code splitting (normative — Appendix A)

**SPEC-5.1.1 — Two-subtree segregation.** The router has exactly three top-level branches: public (`/login`), `/front-desk/*` (Secretary), `/cockpit/*` (Doctor). Each branch is a separately lazy-loaded chunk; cross-branch imports are forbidden (§5.4). The full path table is Appendix A — implementers MUST realize it verbatim (paths, guards, chunk names).

Branch summary:

```
/login (public)
/front-desk            → SecretaryGuard + ShiftGuard(selective)  [chunk: front-desk]
  / (OpsHome)  /board  /receipts  /day-summary  /followups
/cockpit               → DoctorGuard                             [chunk: cockpit]
  / (DoctorCommandDeck)  /consult/:entryId  /chart/:patientId  /meds/:patientId
  /vault/:patientId  /admin/users  /supervision/...
/403  /404  /** → /404
```

**SPEC-5.1.2 — Lazy boundaries.** Every branch uses `loadChildren` route files (`front-desk.routes.ts`, `cockpit.routes.ts`) + `loadComponent` per leaf. Eager imports of a cockpit component from front-desk code (or vice versa) fail the import-graph test (§13). Shared presentational UI (`ui-*`) lives in `shared/ui/` and MUST be ZK-neutral (no Ops/Clinical model imports — pure `@Input/@Output`).

**SPEC-5.1.3 — Chunk budgets.** Initial bundle ≤ 250 kB gz; `front-desk` chunk ≤ 350 kB gz; `cockpit` chunk (incl. scribe/vault/meds) ≤ 600 kB gz; any chunk growth > 10% vs baseline fails CI (§12). Clinical template/charting/vault code MUST NOT appear in the `front-desk` chunk (verified by bundle-audit test, §13).

### 5.2 Route guards — fail-closed, pre-chunk

All guards are functional (`CanActivateFn`/`CanMatchFn`) and execute BEFORE the lazy chunk loads (via `canMatch`), so unauthorized navigation never downloads the forbidden chunk.

| Guard | Input | Logic | Fail action |
|---|---|---|---|
| `authGuard` | `AuthStore` session / `GET /auth/me` restore | valid session required | redirect `/login?returnUrl=<encoded>`; preserve outbox PENDING |
| `roleGuard(required: Role)` → `doctorGuard` / `secretaryGuard` | `AuthStore.me.role` (resolved from `GET /auth/me`, never from client-editable storage) | `me.role === required`, else deny. Doctor MAY access `/front-desk/*` (oversight D-01) — Secretary MUST NEVER access `/cockpit/*` | secretary→cockpit: redirect `/403?reason=role` (no partial render, no skeleton leaking field names — ZK-2); doctor→front-desk allowed |
| `shiftGuard` (cashier routes: board, checkout sheets, petty, close) | `ShiftStore.currentShift` (+ `GET /shifts` fallback) | OPEN shift for today's business date required | no OPEN shift → open `OpsShiftOpenDialog` modal (route stays, modal gates mutations); CLOSED shift → read-only summary + disabled mutation controls (INV-9) |
| `vaultGuard` (extends `doctorGuard`) | separate authz re-check + audit-notice ack state | doctor + explicit vault-notice acknowledged this session | deny → `/403?reason=vault`; every grant logs client-side `VAULT_ACCESS_NOTICE_SHOWN` (ids only) |

**SPEC-5.2.1 — Guard order.** `canMatch: [authGuard, roleGuard]` then `canActivate: [shiftGuard]` where applicable. Guards MUST be pure (no WS/HTTP except the single `GET /auth/me` restore on cold boot).

**SPEC-5.2.2 — Deep-link safety.** Pasting a `/cockpit/*` URL as secretary lands on `/403` with zero clinical fetch attempts (network audit test asserts no `/ehr/*`, `/scribe/*`, `/supervision/*` requests fire — §13).

### 5.3 Zero-knowledge bundling — clinical code excluded from front-desk chunk

**SPEC-5.3.1 — Three-layer enforcement:**

1. **Type layer (ZK-1):** two disjoint model families — `Ops*` (`OpsQueueEntry`, `OpsInvoice`, `OpsReceipt`, `OpsShift`, `IntercomMsg`, `FollowUpTask`) vs `Clinical*` (`ClinicalEncounter`, `Medication`, `VaultNoteRef`, `ScribeSession/Draft`). ESLint `no-restricted-imports` forbids any `Clinical*` import in `features/front-desk/**`, `core/net/ops-api*`, `core/state/ops/**`.
2. **Injector layer (ZK-3):** `ClinicalApi`, `ConsultationStore`, `ScribeStore`, `MedicationStore`, `VaultHolder`, `SupervisionStore` provided ONLY in `cockpit.routes.ts` providers. Secretary subtree cannot resolve them (DI test asserts `TestBed` front-desk context throws on `inject(ClinicalApi)`).
3. **Bundle layer:** bundle-audit CI test parses `dist/front-desk-*.js` for forbidden endpoint strings (`/ehr/`, `/scribe/`, `/vault/`, `/supervision/`) and forbidden class names (`VaultHolder`, `ScribeStore`) — any hit fails the build.

**SPEC-5.3.2 — Text discipline (ZK-5/T-3).** Every free-text composer (`CUSTOM_TEXT`, emergency reason, petty purpose, reversal/write-off/undo reasons) carries the visible hint "Operational only — never type diagnoses, drug names, or findings." No composer pre-fills from clinical state; no "send to desk" buttons exist on SOAP/MSE/meds/vault surfaces (verified by template-audit test).

### 5.4 Dependency & import-graph rules (normative)

```
allowed:
  features/front-desk/** → core/state/ops/**, core/net/ops-api, shared/ui, core/rx-boundary/search
  features/cockpit/**    → core/state/ops/**, core/state/clinical/**, core/net/ops-api, core/net/clinical-api, shared/ui
forbidden:
  features/front-desk/** → clinical-api, clinical state, supervision store, vault, scribe, meds
  shared/ui/**           → ANY store, ANY api facade, ANY Clinical*/Ops* model (ui is model-free)
  ANY **                 → NgModule, BehaviorSubject-as-state
```

Enforced by `eslint-plugin-boundaries` + custom `no-clinical-in-desk` rule + CI tripwire mirror (§13).

### 5.5 Provisioning scopes (normative)

| Provider | Scope | Notes |
|---|---|---|
| `AuthStore`, `SettingsStore`, `QueueStore`, `ShiftStore`, `BillingStore`, `IntercomStore`, `FollowUpStore`, `OutboxStore`, `SocketService`, `OpsApi`, `ToastService` | `root` | Available everywhere |
| `ClinicalApi`, `ConsultationStore`, `ScribeStore`, `MedicationStore`, `VaultHolder`, `SupervisionStore` | `cockpit` route providers | Doctor subtree only; secretary resolution throws |
| `ShiftGuard` dialog state, checkout-sheet state | route/component scope | Never root (avoids cross-patient bleed) |

---

## 6. CSS Architecture & Bidirectional Logical Properties

### 6.1 Styling engine

**SPEC-6.1.1 — Tailwind + CSS variables.** Tailwind CSS (v4 engine or v3 per Step-3 LTS pin — record here) for utilities + semantic CSS variables for theming. No component-scoped color literals; all color surfaces reference variables. Dark mode via `class="dark"` on `<html>` + `prefers-color-scheme` default; manual toggle persisted in `localStorage` (`clinic.theme` — non-clinical, safe).

**SPEC-6.1.2 — Semantic token contract** (Step 3 writes these exact variables in `styles/themes.css`; palettes are calm psychiatric-clinical — low-chroma, high-legibility, non-alarming):

```css
/* CONTRACT SHAPE — styles/themes.css */
:root { /* Light clinical palette */
  --surface-base: #F7F8FA; --surface-raised: #FFFFFF; --surface-overlay: #FFFFFF;
  --ink-primary: #1A2333; --ink-secondary: #5B6B82; --ink-faint: #8A97AB;
  --line-subtle: #E3E8F0; --line-strong: #C7D0DE;
  --accent-calm: #2F6FED; --accent-calm-ink: #FFFFFF;
  --status-wait: #8A6D00; --status-active: #0E7C5B; --status-done: #5B6B82; --status-skip: #9AA5B5;
  --alert-emergency: #C81E1E; --alert-debt: #B45309; --alert-ok: #0E7C5B;
  --focus-ring: #2F6FED;
}
.dark { /* Dark clinical palette — same semantics, luminance-inverted */
  --surface-base: #11161F; --surface-raised: #1A2230; --surface-overlay: #232E42;
  --ink-primary: #EAF0F8; --ink-secondary: #B3BED2; --ink-faint: #7E8CA3;
  --line-subtle: #2A3549; --line-strong: #3D4C66;
  --accent-calm: #5B93FF; --accent-calm-ink: #0B1220;
  /* status/alert hues hold hue, gain luminance for dark-ground contrast */
}
```

**SPEC-6.1.3 — Tailwind mapping.** Tailwind theme extension maps utilities to variables (`bg-base → var(--surface-base)`, `text-primary → var(--ink-primary)`, etc.). Direct hex utilities (`bg-[#…]`, `text-red-500`) are forbidden outside `themes.css` (stylelint `color-no-hex` outside allowlist).

### 6.2 Strict CSS logical-properties mandate (normative)

**SPEC-6.2.1 — Physical-direction ban.** The following are BANNED in all product markup/stylesheets (templates, SCSS, Tailwind classes, inline styles):

```
BANNED: pl-*, pr-*, ml-*, mr-*, left-*, right-* (positional), text-left, text-right,
        border-l-*, border-r-*, rounded-l-*, rounded-r-*, float-left/right, clear-left/right,
        CSS: padding-left/right, margin-left/right, left:, right:, text-align: left/right,
              border-left/right, border-top-left/right-radius (use logical shorthands)
```

**SPEC-6.2.2 — Mandatory logical equivalents:**

```
REQUIRED: ps-*, pe-*, ms-*, me-*, start-*, end-*, text-start, text-end,
          border-s-*, border-e-*, rounded-s-*, rounded-e-*,
          CSS: padding-inline-start/end, margin-inline-start/end, inset-inline-start/end,
               text-align: start/end, border-inline-start/end, inset-block-*
```

Layout direction flows from `dir` attribute (`<html dir="ltr">` default; `rtl` smoke-tested). Flex/grid ordering MUST NOT assume LTR (no `flex-row` with hardcoded "left panel" semantics — name panels `inline-start`/`inline-end`).

**SPEC-6.2.3 — Enforcement.** (1) ESLint template rule `no-physical-classes` (regex on class attributes) fails on banned tokens. (2) Stylelint `property-disallowed-list` fails on physical CSS properties. (3) CI runs an `rtl` visual smoke (`dir=rtl` on board + checkout sheet) asserting zero horizontal overflow and start/end mirroring of drawer/dock placement. Exceptions require an architecture waiver comment (`/* rtl-waiver: <reason> — approved <date> */`) — icon glyphs that must not mirror (e.g., clock hands) are the only anticipated class.

### 6.3 Component styling rules

1. Presentational `ui-*` components use Tailwind utilities + logical properties only; feature SCSS files hold only theme-variable bindings and complex animations.
2. Privacy-blur mode (ZK-7) implemented as a utility class (`.privacy-blur { filter: blur(12px); }`) toggled from a root signal — MUST cover clinical surfaces, toasts, and print previews.
3. Print styles: receipts (operational) printable; clinical surfaces print-disabled via `@media print { body.clinical { display: none } }` + explicit allowlist (receipts only).

---

## 7. Project Topology, Naming & Dependency Rules

### 7.1 Normative directory topology (Step 3 scaffolds exactly this — empty shells first)

```
src/
  main.ts                        # bootstrapApplication only
  app/
    app.component.ts             # shell: router-outlet + toast host + link-state badge
    app.routes.ts                # top-level: login / front-desk (lazy) / cockpit (lazy) / 403 / 404
    core/
      net/                       # ops-api.ts, clinical-api.ts, interceptors/*.ts, http-timeout.ts, idempotency-keys.ts
      realtime/                  # socket.service.ts, queue-ingest.ts, frame-guards.ts (Zod)
      state/
        ops/                     # auth.store, settings.store, queue.store, shift.store, billing.store, intercom.store, followup.store, outbox.store
        clinical/                # consultation.store, scribe.store, medication.store, vault.holder, supervision.store
      rx-boundary/               # search-stream.ts, ws-bridge.ts, http-pipeline.ts (ONLY RxJS zones)
      guards/                    # auth.guard, role.guard, shift.guard, vault.guard
      errors/                    # app-error.ts, error-catalogue.ts, toast.service.ts
      utils/                     # money.ts, time.ts, uuid.ts, payload-hash.ts, validators.ts
    features/
      front-desk/                # routes, guards-scoped providers; OpsHome, board, dialogs/sheets, receipts, summary, followups, dock
      cockpit/                   # routes (+clinical providers); command deck, consult room, scribe studio, MSE panel, timeline, editor, vault, meds, widget, supervision, user admin
    shared/
      ui/                        # model-free presentational units ONLY (buttons, chips, sheets, tables, badges, skeletons)
      forms/                     # typed form builders + explicitness validators (MSE, reason-required)
      i18n/                      # copy tables (operational-only hint strings, error copy)
  styles/                        # themes.css, logical-utilities.css, print.css
  environments/                  # environment.ts / environment.prod.ts (host override ONLY — no secrets)
```

**SPEC-7.1.1 — File naming.** `kebab-case` files, `*.store.ts`, `*.api.ts`, `*.guard.ts`, `*.interceptor.ts`, `*.component.ts/html/scss`, `*.spec.ts` co-located. Ops surfaces prefixed `ops-*`; doctor surfaces `doctor-*`; shared units `ui-*`. A file named `*clinical*` under `front-desk/` fails CI by name alone.

### 7.2 Dependency rule restatement (build-breaking)

`core` has no feature imports. Features import `core` + own files + `shared` only. `shared/ui` imports nothing domain. Cross-feature imports forbidden (front-desk ⇄ cockpit). Clinical state NEVER imported by Ops state. Violations fail `eslint-plugin-boundaries` + dep-cruiser CI.

---

## 8. Domain Models, DTOs & Validation

### 8.1 `Ops*` vs `Clinical*` disjoint families (ZK-1/ZK-4)

```ts
// CONTRACT SHAPE — core/state/ops/ops-models.ts (Ops family — reachable everywhere)
type Minor = number & { readonly __minor: unique symbol };
interface OpsQueueEntry { entryId: string; patientId: string; displayName: string; status: QueueStatus; position: number; isEmergency: boolean; checkedInAt: string; estimatedWaitMin: number; }
interface OpsInvoice { invoiceId: string; patientId: string; queueEntryId: string; standardFeeMinor: Minor; finalFeeMinor: Minor; discountMinor: Minor; discountReason: string | null; status: InvoiceStatus; collectedMinor: Minor; writeOffMinor: Minor; outstandingMinor: Minor; }
interface OpsReceipt { receiptId: string; invoiceId: string; type: ReceiptType; amountMinor: Minor; method: 'CASH' | 'OTHER'; reversalOfReceiptId: string | null; reason: string | null; createdAt: string; }
// ... OpsShift (blind-aware: expectedCashMinor?: NEVER pre-close), IntercomMsg, FollowUpTask, PatientBalance

// CONTRACT SHAPE — core/state/clinical/clinical-models.ts (Clinical family — cockpit ONLY)
interface ClinicalEncounterDraft { encounterId: string; patientId: string; source: 'MANUAL' | 'SCRIBE'; soap: Partial<Soap>; mse: ExplicitMse; diagnoses: string[]; status: 'DRAFT' | 'EDITED'; }
type MseField = string | 'NOT_PERFORMED'; // literal required; missing rejected (CONV-09)
interface ExplicitMse { appearance: MseField; behavior: MseField; speechCoherence: MseField; moodAffect: MseField; }
```

**SPEC-8.1.1 — Blind-aware shift type.** The pre-close `ShiftSummary` type MUST NOT contain `expectedCashMinor` / `differenceMinor` as optional fields — they live on a SEPARATE `ClosedShiftReveal` type returned only by `closeBlind()` post-persist (P-04/C-12). `result`/`differenceMinor` pre-close are `null` (rendered as absent, never `0`).

### 8.2 Runtime guards (frontend Zod-equivalent)

Every WS frame and every `unknown` boundary is validated by a guard in `core/realtime/frame-guards.ts` + `core/utils/validators.ts` before entering a store. MSE guards enumerate `'NOT_PERFORMED'` literally (tripwire §13). `CUSTOM_TEXT` length cap enforced pre-send (server cap mirrored; over-cap blocked client-side with counter).

### 8.3 Checkout / pay / correction semantics (INV-1…INV-10 binding)

- **Append-only money UI (P-05/INV-3/INV-4/INV-7):** no "edit invoice" control exists. Discount fixed at creation; shortfalls → `pay`; errors → doctor `reverse` (one REVERSAL per CHARGE, ≤ amount, reason required); uncollectible → doctor `write-off`. Closed shift disables all mutation controls (INV-9).
- **Floor (INV-6/S-10):** checkout sheet computes `maxAllowedDiscount = min(secretaryMaxDiscountMinor, round(standardFeeMinor * pct/100))` from `SettingsStore`; breach blocked pre-dispatch with "requires doctor" guidance; server `403 FLOOR_VIOLATION` maps to same guidance + audit notice.
- **Oldest-first (C-07/GAP-09):** `BillingStore.allocateOldestFirst(patientId, amountMinor)` sorts `balance.lines` ascending by date, issues sequential `pay` calls each with its OWN `Idempotency-Key`, renders running remainder. Never nets across invoices in one call.
- **Titration saga (D-11/C-21):** `MedicationStore.titrateSaga(oldId, newSpec, cessationReason)` executes create-new-ACTIVE then discontinue-old; on half-failure surfaces exactly which half landed + one-click repair action. UI copy MUST state "two-step (not atomic)" — claiming atomicity is a defect.
- **Overlap flags (D-12/C-22):** purely client-side date-range/agent overlap badges, labeled "Advisory — not a clinical decision," never blocking, never dose-advising.

### 8.4 Scribe studio state machine (GAP-06/GAP-08 tolerant)

States: `IDLE → SESSION_CREATED(UPLOADED) → RECORDING → STOPPED → TRANSCRIBING → TRANSCRIBED → DRAFT_DRAFTED → DRAFT_EDITED → SIGNED` with lock branches `WITHDRAWN` / `PURGED` / `FAILED`. Studio tolerates single-session drafts today; multi-session binding readiness: `scribeSessionIds: string[]` accepted by the draft-creation intent signature but constrained to length 1 until GAP-08 ratified (length > 1 blocked with "awaiting server support" notice, not silent truncation). No status-GET polling loops: studio resyncs on draft events + manual Refresh + 10 s bounded poll ONLY while `TRANSCRIBING` (max 6 polls, then "check back" state) — GAP-06 posture.

---

## 9. Forms, Money, Time & Rendering Rules

**SPEC-9.1 — Typed Reactive Forms.** All clinical/operational forms are typed `FormGroup`/`FormControl` with explicit validators. Reason-required fields use `nonBlankValidator` (empty/whitespace = invalid — P-06). MSE uses four required chip-group controls where `null` (missing) ≠ `'NOT_PERFORMED'` (C-10); submit with any `null` blocked + `422 MSE_REQUIRED` details mapped per-selector.

**SPEC-9.2 — Minor-unit money edge (C-11/P-10).** Integer arithmetic ONLY (`Money.add/sub/min` in `core/utils/money.ts`; floats throw). Currency/decimals from `GET /settings` at render (`Intl.NumberFormat` with `currency`). No hard-coded currency symbols. Quick-amount chips (exact fee / exact outstanding / custom) feed `collectedMinor` directly.

**SPEC-9.3 — Time (C-20).** Wire UTC strings → local render via `core/utils/time.ts` (`formatLocal`, `relativeAgo`, shift-day boundary helper). Wait times rendered from server `estimatedWaitMin` ONLY — no client recomputation.

**SPEC-9.4 — State-machine rendering (P-07).** Queue, scribe, shift, follow-up, invoice statuses each render from a single canonical client machine (subset of server machine); illegal transitions are disabled buttons with reason tooltips, never hidden-then-500s. `400 ILLEGAL_TRANSITION` (if ever received) converges to snapshot silently + logs.

**SPEC-9.5 — Form durability (C-18).** Dirty-guard on all sheets; draft persistence to disk allowed ONLY for non-clinical forms (checkout notes, petty purpose). Clinical drafts (SOAP/MSE/vault/scribe text) persist in MEMORY ONLY; reload drops them with an explicit "unsaved clinical draft discarded" notice (never silent data loss, never disk leak).

---

## 10. Security, Privacy & Vault Hygiene

**SPEC-10.1 — Token hygiene (C-24).** Access JWT in memory only (`AuthStore`, never `localStorage`/`sessionStorage`). Refresh via httpOnly secure cookie (`withCredentials`). 401 → single-flight refresh → replay; refresh-family failure → fail-closed logout. `change-password` rotates session. No token in URLs, logs, or error reports.

**SPEC-10.2 — Clinical-free chrome (ZK-7).** Document titles, toasts, notification previews, and command-palette entries MUST NEVER contain clinical content (no SOAP text, diagnoses, drug names, vault excerpts, MSE values). Toast copy reviewed against an allowlist of operational templates (§11). Command palette segregates doctor commands (invisible/unresolvable in secretary context — C-08).

**SPEC-10.3 — Privacy mode + auto-lock (C-14).** One-click blur toggle on all clinical surfaces (covers content + toasts + print preview); idle auto-lock (default 5 min, configurable) scrubs vault + locks scribe sessions from editing (re-auth to resume); lock on `visibilitychange: hidden` for vault route (configurable per deployment).

**SPEC-10.4 — Vault ephemerality (ZK-6/C-15).** Plaintext lives ONLY in `VaultHolder` memory map. Scrub triggers: lock, logout, role switch, tab-hide (vault route), route exit from vault surface, idle-lock. Scrub = `map.clear()` + `Uint8Array` zero-fill where applicable + signal reset; verified by memory-hygiene test (no `localStorage`/`sessionStorage`/IndexedDB keys matching `vault|soap|scribe` — §13). Vault read shows `VAULT_ACCESS` audit notice (reads are logged id+timestamp only). **No shred affordance ships** until GAP-05 ratified — UI shows "Retention: shred unavailable in Phase 1" rather than a fake button.

---

## 11. UX Shells: Toasts, Dialogs, Command Palette, Offline

**SPEC-11.1 — Toasts.** Single `ToastService` (root) fed ONLY by `errorEnvelopeInterceptor` + store intent results. Templates operational-only; severity `info|success|warning|error`; every error toast carries action affordances per Appendix C (Retry with same key / Review board / Fresh intent / Report incident). Toast queue buffered during WS loss (C-09) with max 5 + overflow counter.

**SPEC-11.2 — Dialogs/sheets.** All money/queue mutations run through confirm sheets carrying: explicit amount display (minor→formatted), reason field where required, idempotency-key state chip ("Safe to retry" vs "Fresh intent needed"), and OCC version chip where applicable ("Queue v{N}"). Destructive/irreversible actions (reversal, write-off, blind close, consent withdraw) require typed confirmation or dual-tap.

**SPEC-11.3 — Command palette (C-08).** `Ctrl/Cmd+K` palette with role-filtered commands (secretary never resolves doctor commands — enforced by the same guard predicates as routing). Includes call-next (doctor), check-in focus, checkout submit, intercom focus, `?` shortcut overlay.

**SPEC-11.4 — Offline shell (C-09/P-09).** Global link-state badge (LIVE/DEGRADED/OFFLINE) with last `queueVersion`/`serverAt`; DnD disabled unless LIVE; mutations chip "will confirm"; staleness polling 15 s REST.

---

## 12. Build, Environments, Budgets & CI Gates

**SPEC-12.1 — Environments.** `environment.ts` / `environment.prod.ts` carry ONLY: `apiHost` (dev proxy override), `wsPath`, `appVersion`, `sentryDsn?` (no secrets), feature flags (`zoneless`, `rtlSmoke`). Secrets NEVER in repo (backend `.env` parity). CORS/socket origins server-owned.

**SPEC-12.2 — Budgets (normative, `angular.json`).** Initial ≤ 250 kB gz; `front-desk` ≤ 350 kB; `cockpit` ≤ 600 kB; component-level: any lazy route > 150 kB triggers review. `maximumError` set 10% above each; CI fails on breach.

**SPEC-12.3 — Lint gates (all blocking).** `prefer-on-push`, `no-ngmodule`, `no-rxjs-outside-boundary`, `no-physical-classes` (templates), `no-clinical-in-desk` + `boundaries`, `@typescript-eslint/no-explicit-any`, template `strictTemplates` (via `tsc`), stylelint physical-property ban, bundle-audit (no clinical strings in front-desk chunk), RTL smoke.

**SPEC-12.4 — Pipeline order.** `typecheck → lint → unit → tripwire-mirror → bundle-audit → budgets → e2e-smoke (auth/queue/checkout/blind-close happy paths with mocked WS)` — any red blocks merge (mirrors backend App. F philosophy).

---

## 13. Test Strategy & Frontend Tripwire Mirror

### 13.1 Pyramid

| Layer | Scope | Examples |
|---|---|---|
| Unit (stores/pipes/guards) | signal graphs, floor math, oldest-first ordering, version gating, guard predicates | floor-meter tighter-wins; `gateFrameVersion` drop/apply/resync; secretary-cannot-resolve-ClinicalApi |
| Integration (facade + interceptor + outbox) | header attachment, replay-as-success, REUSE terminality, STALE snap-back | reorder sends `If-Match`+body+key; 409 applies snapshot + no auto-retry; `Idempotent-Replayed` reconciles |
| Component (harness) | sheets/dialogs validation, MSE missing-vs-NOT_PERFORMED, blind-close two-phase | empty reason blocked; close screen has no expected field pre-reveal |
| E2E smoke (mocked WS/REST) | J-01…J-08 acceptance narratives (Step 1 §2.6) | routine return visit; blocked close; consent withdrawal |
| A11y/i18n/RTL | keyboard nav, focus traps, `dir=rtl` smoke, logical-property audit | drawer mirrors start/end; no `pl-/pr-` in bundle |

### 13.2 Frontend tripwire mirror (normative — adopts Step 1 §4.7; each CI-blocking)

| ID | Mirror of | Assertion |
|---|---|---|
| FT-1 | backend C-3/F-1 | Import-graph test: zero `Clinical*` imports reachable from `front-desk/**`; bundle-audit: zero clinical endpoint strings in front-desk chunk; `?include=clinical` fuzz on `OpsApi` yields no clinical keys |
| FT-2 | backend F-1/CONV-02 | Allowlist snapshot: secretary-rendered fixtures (queue/invoice/receipt/shift/intercom) contain ONLY allowlisted keys; extra key fails |
| FT-3 | backend C-9 | Request-interceptor test: every reorder/emergency dispatch carries `If-Match` + matching version body + `Idempotency-Key`; missing version blocks dispatch |
| FT-4 | backend C-10 | MSE schema test: guards accept each selector = clinical-value OR literal `'NOT_PERFORMED'`; `null`/missing rejected distinctly |
| FT-5 | backend C-12/F-4 | Blindness test: close-dialog + pre-close summary component trees contain NO expected-value field/selector/computed; `ClosedShiftReveal` type unreachable pre-persist; `0` never rendered for null result/difference |
| FT-6 | guards/ZK-2 | Navigation test: secretary deep-link to every `/cockpit/*` path lands `/403` with ZERO `/ehr/*`/`/scribe/*`/`/supervision/*` requests fired |
| FT-7 | C-05/F-10 | Outbox test: same key+payload replay → single intent, success reconciled; same key+different hash → terminal stop, fresh key required; PENDING survives reload, clinical never persisted |
| FT-8 | ZK-6/C-15 | Memory-hygiene test: after scrub triggers, `localStorage`/`sessionStorage`/IndexedDB contain zero keys matching `vault\|soap\|scribe\|mse`; VaultHolder map empty |

---

## 14. Step-1 Decision Register (§6.2 Resolved) & Gap Disposition

Step-1 §6.2 carried seven decisions into this spec — resolved here (no deferrals into Step 3):

| # | Step-1 question | Step-2 decision (this spec) |
|---|---|---|
| 1 | Angular module boundary for ZK (lazy subtree + injector-scoped `ClinicalApi` vs build-time split) | **Lazy doctor subtree + injector-scoped `ClinicalApi`/clinical stores + bundle-audit + import-graph lint** (§5). No separate builds (single deployable; oversight D-01 requires doctor→desk access). Build-time split rejected: doubles deploy/flag surface with zero additional secrecy (server 403s remain authoritative) |
| 2 | State container for versioned queue + outbox persistence | **Hand-rolled signal stores + `OutboxStore` in `localStorage`** (§2.2/§2.5). No NgRx: versioned-snapshot + outbox semantics are simpler and smaller as signals; entries NOT persisted (refetch authoritative), only version meta + outbox PENDING |
| 3 | Scribe studio machine under GAP-06/GAP-08 | **Single-session-tolerant, multi-session-ready** (§8.4): signature accepts `scribeSessionIds[]` capped at 1; bounded TRANSCRIBING poll (6×10 s); resync on draft events |
| 4 | Unsigned-notes roster under GAP-02 | **Local-first roster**: `ConsultationStore` tracks doctor's own started-but-unsigned consults this shift (from `call-next`/`complete` intents + chart absence); adopts proposed `GET /ehr/encounters?status=DRAFT` automatically IF ratified (adapter interface pre-defined, no UI change) |
| 5 | WS client design | **Singleton `SocketService` + version-gated ingest + jittered backoff + 15 s REST fallback** (§4); `queue.reorder` REST-only |
| 6 | API facades + interceptors | **`OpsApi` (root) / `ClinicalApi` (cockpit-scoped) + five-interceptor chain in normative order** (§3.2, App. B) |
| 7 | Frontend tripwire mirror in CI | **FT-1…FT-8 blocking gates** (§13.2) mirroring backend C-3/C-4/C-9/C-10/C-12 + F-1/F-4/F-5 |

**Gap disposition (GAP-01…GAP-11 — interim postures are Step-3 build rules until backend ratification):**

| GAP | Posture encoded in this spec |
|---|---|
| GAP-01 encounter `If-Match` | §3.5.2: never send; reload → addendum |
| GAP-02 unsigned backlog | §14-4 local roster + pre-defined adapter |
| GAP-03 open-shift receipt suppression | Receipts route + archive nav suppressed for secretary while shift OPEN (client rule); server ratification still requested |
| GAP-04 petty INJECTION | EXPENSE-only (§8.3); top-ups via `openingFloatMinor` |
| GAP-05 vault shred | No affordance; placeholder copy (§10.4) |
| GAP-06 status polling | Bounded poll + event resync (§8.4) |
| GAP-07 synthesis directive | MSE-only submission; prioritization server-side |
| GAP-08 multi-session draft | Single-session tolerance, length-1 cap (§8.4) |
| GAP-09 oldest-first | Client orchestration C-07 (§8.3); no server change needed |
| GAP-10 channel labels | Preset→`CASH\|OTHER` map; labels UI/print only |
| GAP-11 undo window | Local countdown from own `complete` intent; request DTO field |

---

## 15. Traceability Matrices

### 15.1 Features → spec binding (31 core; deferred/excluded fenced by §5.3 gate — no bindings by design)

| Feature | Primary spec binding |
|---|---|
| S-01 check-in + debt-ack | §2.2 QueueStore, §3.4 idempotency, §4.2 ingest, App. A `/front-desk` check-in dialog, App. C debt-ack row |
| S-02 registration + duplicate | §2.4 R-1 search stream, §8 guards, App. C `409 candidate` row |
| S-03 crisis intake | App. A crisis dialog; §8 emergency-anchor-only guard; §11 dual-tap confirm |
| S-04 queue lanes | §2.2 QueueStore, §4.2 snapshot discipline, §9.4 machine |
| S-05 DnD reorder (OCC) | §2.4 R-2/R-3, §3.2 occVersionInterceptor, §3.5.1 STALE protocol, §4.4 gate |
| S-06 emergency flag | §3.2 occVersion, §3.5.1, App. C reason-422 row |
| S-07 wait times | §4.2.3 server-values-only; §2.2 `headWaitMin()` computed |
| S-08/S-09/S-10 fee/floor | §8.3 floor formula; §9.1 nonBlank; App. C FLOOR row |
| S-11 methods | §8 preset→enum map (GAP-10); §9.2 chips |
| S-12 debt oldest-first | §8.3 `allocateOldestFirst`; §2.5 per-invoice keys |
| S-13 receipts archive | App. A receipts route; GAP-03 suppression; §6.3 print allowlist |
| S-14 intercom dock | §2.2 IntercomStore; §4.2 effect receipts; §10.2 hint copy |
| S-15 petty | §8.3 append-only; App. B route table; App. C purpose-422 |
| S-16 blind close | §8.1 blind-aware types; §13 FT-5; App. C INVARIANT row |
| S-17 day summary | §8.1 null-vs-0; §6 print |
| S-18 ZK isolation | §5.3/§5.4/§10 + FT-1/FT-2/FT-6/FT-8 |
| D-01 oversight | §2.2 SupervisionStore (doctor scope); §4.2 discrepancy channel |
| D-02 queue command | §2.2 intents; §9.4 machine; App. C single-consult/undo rows |
| D-03 audio ingest | §2.2 ScribeStore; §9 (60 s cap countdown C-03); §10.4 buffer bounds |
| D-04 MSE chips | §8.1 `ExplicitMse`; §9.1 missing-vs-NOT_PERFORMED; FT-4 |
| D-05 scribe 3-pass | §8.4 machine; §10 consent surfacing C-13 |
| D-06 timeline | §2.2 chart `resource`; SIGNED-only rule |
| D-07 manual SOAP | §8; GAP-01 posture |
| D-08 addenda | §8.3 append-only; version display |
| D-09 vault | §2.2 VaultHolder; §5.2 vaultGuard; §10.4; GAP-05 |
| D-10 meds | §2.2 MedicationStore; cessation-reason gate |
| D-11 titration | §8.3 saga + repair screen |
| D-12 overlap flags | §8.3 advisory labeling |
| D-13 directives widget | §2.2 + §4.2 receipts; App. B complimentary-key rule |

### 15.2 Capabilities → binding: C-01…C-24 each bound in §§2–11 (index: C-01 §3.5.1; C-02 §2.2/D-03; C-03 §9; C-04 §2.2/GAP-11; C-05 §2.5; C-06 §9.2; C-07 §8.3; C-08 §11.3; C-09 §4.5/§11.4; C-10 §9.1; C-11 §9.2; C-12 §8.1/FT-5; C-13 §2.2/§8.4; C-14 §10.3; C-15 §10.4/FT-8; C-16 App. C; C-17 §2.4 R-1; C-18 §9.5; C-19 §6.3; C-20 §9.3; C-21 §8.3; C-22 §8.3; C-23 §4.2; C-24 §3.3/§10.1).

### 15.3 INV → binding: INV-1 §8.3 reconcile-to-server; INV-2 §2.2 server-derived badges; INV-3/4/5/6/7/8/9/10 §8.3 + App. C rows (each invariant has ≥1 interceptor/store/test binding — full table in §8.3).

---

## 16. Step-3 Entry Criteria & Build Order

**SPEC-16.1 — Entry gates (all MUST hold before Step 3 writes app code):** (1) this spec approved; (2) LTS versions pinned (§1.1 amendment); (3) `tsconfig`/lint/budgets committed per §§1.4/12; (4) FT-1…FT-8 skeletons committed red-then-green; (5) route shells + guard predicates committed behind `canMatch` (no leaf UI yet); (6) `Ops*`/`Clinical*` model files + blind-aware shift types committed.

**SPEC-16.2 — Build order (constrained by BE-101→702):** shells+guards → Auth/Settings/Queue+WS ingest → check-in/registration/board (S-01…S-07) → billing/shift/blind-close (S-08…S-17) → intercom/follow-ups (S-14) → doctor command + consult room + MSE (D-01…D-04) → scribe studio (D-05) → chart/meds/vault (D-06…D-12) → directives widget + supervision + user admin (D-13/D-01 tail) → hardening (FT gates, RTL smoke, budgets, J-01…J-08 E2E).

---

## Appendix A — Canonical Route Tree (normative)

| Path | Chunk | Guards | Surface intent (Step-1 §2.2/§2.4) | Notes |
|---|---|---|---|---|
| `/login` | main | public (redirect if authenticated) | Session bootstrap | | 
| `/front-desk` | front-desk (lazy) | `authGuard, secretaryGuard` | Secretary subtree root | doctor MAY also enter (oversight); provides NO clinical |
| `/front-desk/` | front-desk | + `shiftGuard` (advisory) | `OpsHome` dashboard | shift status, collections, debt alerts, directives |
| `/front-desk/board` | front-desk | + `shiftGuard` (enforcing) | `OpsWaitingRoomBoard` | DnD disabled unless WS LIVE |
| `/front-desk/receipts` | front-desk | auth+role | `OpsReceiptArchivePage` | closed shifts only; open-shift nav suppressed (GAP-03) |
| `/front-desk/day-summary` | front-desk | auth+role | `OpsDaySummaryPage` | null-slots absent pre-close |
| `/front-desk/followups` | front-desk | auth+role | `OpsFollowUpBoard` | REQUESTED→SCHEDULED→DONE |
| (dialogs, not routes) | front-desk | — | `OpsCheckInDialog`, `OpsPatientRegistrationWizard`, `OpsCrisisIntakeDialog`, `OpsDebtSettlementSheet`, `OpsBillingCheckoutSheet`, `OpsPatientBalancePanel`, `OpsPettyCashSheet`, `OpsBlindDrawerCloseDialog`, `OpsShiftOpenDialog`, `OpsIntercomDock` (persistent) | modal/drawer/dock intents per Step-1 §2.2 |
| `/cockpit` | cockpit (lazy) | `authGuard, doctorGuard` + clinical providers (§5.5) | Doctor subtree root | provides `ClinicalApi` + clinical stores |
| `/cockpit/` | cockpit | auth+role | `DoctorCommandDeck` | oversight + queue command |
| `/cockpit/consult/:entryId` | cockpit | auth+role | `DoctorConsultRoom` (embeds `DoctorScribeStudio`, `DoctorMseChipPanel`, `DoctorEncounterEditor`) | audio+MSE+scribe/manual |
| `/cockpit/chart/:patientId` | cockpit | auth+role | `DoctorChartTimeline` | SIGNED only |
| `/cockpit/meds/:patientId` | cockpit | auth+role | `DoctorMedicationTracker` | titration saga entry |
| `/cockpit/vault/:patientId` | cockpit | auth+role+`vaultGuard` | `DoctorVaultPage` | ephemeral; audit notice |
| `/cockpit/supervision` | cockpit | auth+role | `DoctorSupervisionViews` | activity/cash/discrepancies/readiness |
| `/cockpit/admin/users` | cockpit | auth+role | `DoctorUserAdmin` | BE-104 provisioning |
| (widget, not route) | cockpit | — | `DoctorDirectivesWidget` (floating) | Call-Next / Complimentary / Follow-up |
| `/403` `/404` | main | public | Fail-closed pages | `/403` carries `?reason=role\|vault\|shift` (no clinical detail) |

---

## Appendix B — Interceptor Chain Order & Idempotency Route Table

**Chain (outgoing):** `authInterceptor(1) → occVersionInterceptor(2) → idempotencyInterceptor(3) → refreshTokenInterceptor(4) → errorEnvelopeInterceptor(5)`.

| Route (client → server) | `Idempotency-Key` | `If-Match` + version body | Notes |
|---|---|---|---|
| `POST /auth/login`, `POST /auth/refresh`, `GET /health` | never | never | public; excluded from authInterceptor Bearer |
| `GET /auth/me`, `GET /settings`, all `GET *` | never | never | reads are keyless |
| `POST /queue/check-in` | REQUIRED (mint/reuse) | never | debt-ack retry reuses SAME key (same payload + `acknowledged:true` counts as same intent — pre-agreed hash covers ack flag transition; any other payload change mints new key) |
| `POST /queue/reorder` | REQUIRED | REQUIRED (`If-Match` + `expectedQueueVersion`, must match) | version sourced from QueueStore; no-snapshot blocks dispatch |
| `POST /queue/:id/emergency` | REQUIRED | REQUIRED (`If-Match`) | reason required both directions (flag + unflag) |
| `POST /queue/:id/call-next\|skip\|requeue\|complete` | never (server has no key requirement) | never | `force` confirm + audit for single-consult 409; undo separate row |
| `POST /queue/:id/undo-complete` | REQUIRED (`{reason}` + key) | never | single-hop, windowed; invoice NOT deleted |
| `POST /billing/checkout` | REQUIRED | never (`lockShift` server-side; `SHIFT_LOCKED` → bounded retry same key) | `409 already invoiced` pivots to pay-down |
| `POST /billing/invoices/:id/pay` | REQUIRED (per-invoice key) | never | oldest-first orchestrator mints one key per line |
| `POST /billing/receipts/:id/reverse` | REQUIRED | never | doctor-only; reason required |
| `POST /billing/invoices/:id/write-off` | REQUIRED | never | doctor-only; reason + amount required |
| `POST /shifts/:id/petty` | REQUIRED | never | EXPENSE-only; OPEN shift only |
| `POST /shifts/:id/close` | REQUIRED | never | `{actualCountedMinor}` only; reveal type separate |
| `POST /intercom` | REQUIRED iff `type===DOCTOR_COMPLIMENTARY` (REST and `intercom.send` WS) | never | type-ownership enforced; forged types impossible (role-derived, not user-selected) |
| `POST /ehr/*`, `POST /scribe/*`, vault routes | never | NEVER (GAP-01: forbidden) | draft/version semantics instead |

---

## Appendix C — Error Catalogue Binding (normative)

Failure envelope `{error:{code,message,details}}` → behavior. Unknown codes → safe generic + incident id, never retry loops.

| Code (HTTP) | UX behavior (normative) | Owner |
|---|---|---|
| `IDEMPOTENCY_KEY_REQUIRED` (422) | attach key, retry ONCE silently; second failure → hard error + report | outbox/interceptor |
| `IDEMPOTENCY_KEY_REUSE` (422) | HARD STOP: "This receipt key was already used for a different amount — start a fresh intent." Discard key, require new confirm (new UUID) | all money surfaces |
| `STALE_QUEUE` (409 + snapshot) | apply snapshot, snap-back ghost, toast "Queue changed (v{a}→v{b}) — review and retry." NO auto-retry | board/reorder/emergency |
| `SHIFT_LOCKED` (409) | bounded retry same-key ×3 (250/750/2000 ms) → then "Drawer busy — Retry (same key held)" button | checkout/pay/petty/close |
| `INVARIANT_VIOLATION` (409 + `discrepancies[]`) | blocking dialog listing `discrepancies[]` with resolve-or-escalate paths; close halted; doctor force-with-reason path offered with audit notice | close → supervision |
| `FLOOR_VIOLATION` (403) | "Requires doctor — discount exceeds secretary floor." Route to doctor complimentary/write-off path; no retry, no silent escalation | checkout |
| reason/`DISCOUNT` 422s | focus offending justification field; inline message; preserve amounts | checkout/reversal/write-off/petty/emergency/undo |
| `MSE_REQUIRED` (422) | per-selector mapping distinguishing missing (`null`) vs `NOT_PERFORMED`; focus first missing chip row | MSE panel/drafts/sign |
| `CONSENT_REQUIRED` (422) | consent-capture step; block session create until `consentConfirmed` | scribe |
| `WITHDRAWN_GONE` (403) / `GONE` (410) | "Session withdrawn/purged — start a new session." Lock transcribe/upload/draft actions | scribe |
| `ILLEGAL_TRANSITION` (400) | silent converge to snapshot (unreachable by design); log only | queue command |
| `ALREADY_REVERSED` (400) / pay-on-PAID (400) / `409 already invoiced` / `409 duplicate open entry` | pivot to current-state view (receipt chain / pay-down surface / existing entry "jump to queue") — never an error page | receipts/pay/checkout |
| `UNAUTHORIZED` (401) | single-flight refresh → replay; refresh failure → fail-closed logout `/login?reason=session` | session/guards/WS |
| `FORBIDDEN` (403) incl. deactivated + secretary→clinical | deactivated: immediate lockout + scrub + "contact the doctor"; secretary→clinical: `/403` page, zero clinical fetch | session/guards |
| `NOT_FOUND` (404) | remove stale reference, resync list, toast "No longer available — list refreshed" | all entity views |
| `INTERNAL` (500 + incident id) | "Something went wrong (ref {id})." + Report affordance; correlation logged; no clinical payload in report | global boundary |

---

## Appendix D — Glossary

OCC (`Shift.queueVersion` + `If-Match`/version-body); `SecretSafe<T>` (backend allowlist brand mirrored by `Ops*`/`Clinical*` split); blind close (expected revealed post-actual); CHARGE/REVERSAL (immutable pair); idempotent replay (`200 + Idempotent-Replayed: true`); debt-ack (`201 entry + advisory debtAlert` → `acknowledged:true`); floor (`secretaryMaxDiscountMinor/Pct`, tighter wins); INV-1…INV-10 (close-gating invariants); RPS-2 (applied backend revision series); link-state (LIVE/DEGRADED/RECONNECTING/DISCONNECTED); outbox (UUIDv4 intent durability); snapshot (`queue.updated` + `queueVersion` monotonicity).

---

*End of Step 2 specification. Next: Step 3 scaffolding + store/facade implementation per §§7/16, bound by the normative appendices. No Step-3 code is authorized outside this spec's route tree, interceptor order, store catalogue, model families, logical-property mandate, and FT-1…FT-8 gates.*
