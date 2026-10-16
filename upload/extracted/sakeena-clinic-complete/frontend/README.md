# سكينة — نظام إدارة العيادة النفسية (الواجهة الأمامية)

React 19 + Vite + TypeScript frontend for the Psychiatric Clinic Management
System, integrating the Figma-exported design with the existing Express /
Prisma / Socket.io backend (`../backend`, port 4000, base path `/api/v1`).

## Quick start

```bash
# 1) Backend (disposable embedded PostgreSQL + API on :4000)
cd ../backend
npm install
npx prisma generate
QA_INFO_PATH=../../clinic/qa-info.json npx tsx qa-boot.mts

# 2) Frontend (Vite dev server on :3000, proxies /api and /socket.io to :4000)
cd ../frontend
pnpm install
PORT=3000 pnpm dev
```

Open http://localhost:3000.

## Test accounts (QA/disposable database)

| Role | Identifier | Password |
|---|---|---|
| Doctor | `doctor` | `Doctor#456!` (rotated from seed `ChangeMe123!`) |
| Secretary | `sara` | `Secretary#789!` (created via the doctor's settings screen) |

First login of any seeded/created user forces a password change
(`mustChangePassword`) — the UI routes to `/change-password` automatically.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8443` (use `3000`) | Vite dev/preview port — must match backend CORS |
| `CLINIC_BACKEND_URL` | `http://127.0.0.1:4000` | Proxy target for `/api` and `/socket.io` |
| `VITE_API_BASE` | `/api/v1` | API base path (proxied) |

The refresh cookie is HttpOnly with `path=/api/v1/auth`; the Vite proxy keeps
everything same-origin so cookies and the socket handshake work everywhere.

## Architecture

```
src/
├── api/            # typed API layer (client.ts is the ONLY fetch site)
│   ├── client.ts   # bearer token, silent refresh, Idempotency-Key, errors
│   └── *.ts        # endpoint modules (auth, patients, queue, billing, …)
├── realtime/       # socket.io (queue.snapshot, intercom.received, …)
├── auth/           # session lifecycle (in-memory JWT + cookie refresh)
├── components/     # design-system primitives from the Figma export
├── screens/        # one file per route (design preserved)
├── hooks/          # useQueue (REST + WS convergence)
└── lib/            # ar-EG formatting helpers + centralized Arabic strings
```

Design fidelity: `src/index.css` keeps the original 224-line stylesheet
untouched; integration-only additions (skeletons, error toast, waiting-room
display) are appended in a clearly marked section using the same tokens.

## Scripts

- `pnpm dev` — dev server (set `PORT=3000`)
- `pnpm build` — production build
- `pnpm preview` — preview the build
