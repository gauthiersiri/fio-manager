# FIO Manager – frontend

React 18 + TypeScript + Vite 5 + Tailwind CSS v4, shadcn-style components (Radix UI primitives, in `src/components/ui/`) and Recharts. Fonts (Inter, JetBrains Mono) are bundled, so the UI works air-gapped.
API contract: `../docs/api.md`.

```bash
npm install
npm run dev      # http://localhost:5173, proxies /api -> http://localhost:8080
npm run build    # type-check + build into dist/ (served by the backend at /)
npm run mock     # optional throwaway mock API on :8080 (mock/server.mjs)
```

Routes: `/` runs, `/runs/new`, `/runs/:id/edit`, `/runs/:id` (Overview / Logs / Graphs), `/compare?ids=a,b`.
