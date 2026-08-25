// Imp Credits service origin — the connect page, the exchange endpoint, and
// the metered /api/v1 API all live under this origin. Only the API key is
// persisted in settings; this origin (and the API base derived from it) is a
// constant. The model is server-authoritative (imp-standard), so it is never
// stored or sent by the client.
export const IMP_ORIGIN = 'https://imp.rxliuli.com'

// The SPA connect page linked from the options page. `src` is recorded on the
// connection as provenance so the metered proxy can pick a per-extension
// model/pricing tier (see imp-credits apps/api/src/routes/connect.ts).
export const IMP_CONNECT_URL = `${IMP_ORIGIN}/connect?src=bilingual-tube`

// Base for the metered API. The exchange response returns a baseUrl of
// `${DASHBOARD_URL}/api/v1` which equals this in production, so we don't
// persist it — the constant stays authoritative and dev-localhost swaps
// propagate through IMP_ORIGIN automatically.
export const IMP_API_BASE = `${IMP_ORIGIN}/api/v1`
