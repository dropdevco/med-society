import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import type { ServerResponse } from 'node:http'

/**
 * Vercel's Node runtime augments the plain `http.ServerResponse` with
 * `.status()` / `.json()` helpers (see api/place-photo.ts and
 * api/lead-notify.ts, which both rely on that shape). Vite's dev middleware
 * hands us a bare connect response, so this adds the same two methods before
 * the handler ever sees it.
 */
function withVercelHelpers(res: ServerResponse) {
    const augmented = res as ServerResponse & { status: (code: number) => typeof augmented; json: (body: unknown) => void }
    augmented.status = (code: number) => {
        augmented.statusCode = code
        return augmented
    }
    augmented.json = (body: unknown) => {
        if (!augmented.headersSent) augmented.setHeader('Content-Type', 'application/json')
        augmented.end(JSON.stringify(body))
    }
    return augmented
}

/**
 * Dev-only shim for /api/place-photo (see api/place-photo.ts).
 *
 * Vercel serves that file as a serverless function in production, but
 * `npm run dev` has no such runtime — without this plugin, requests to
 * /api/place-photo would fall through to the SPA history fallback and get
 * index.html back with a 200, which src/utils/placePhoto.ts's health probe
 * is specifically written to treat as "proxy not available" (see its
 * comment). This plugin loads the same handler module through Vite's SSR
 * pipeline (so it gets TS transpilation and HMR for free) and calls it
 * directly, so `npm run dev` exercises the exact same endpoint as prod.
 */
function placePhotoDevMiddleware(mode: string): Plugin {
    return {
        name: 'dev-place-photo-api',
        apply: 'serve',
        configureServer(server) {
            // A key or Supabase credentials in .env.local (or the shell env)
            // should work in dev exactly like it does on Vercel. loadEnv reads
            // .env* files itself; process.env already holds shell-exported
            // vars, so we only fill in what isn't already set.
            const env = loadEnv(mode, process.cwd(), '')
            for (const key of ['GOOGLE_PLACES_SERVER_KEY', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'LEAD_NOTIFY_TO', 'LEAD_NOTIFY_FROM', 'OPENROUTER_API_KEY', 'FORUM_NOTIFY_FROM', 'CRON_SECRET', 'PUBLIC_SITE_URL']) {
                if (!process.env[key] && env[key]) process.env[key] = env[key]
            }

            // The agent surface (api/agent.ts) is reached in production through the
            // rewrites in vercel.json. Mirror the non-page ones here so `npm run dev`
            // answers /api/v1/*, /mcp, /openapi.json, /llms.txt and the sitemaps too.
            // The HTML routes (/, /providers/:id…) stay with Vite, which serves the app;
            // reach the pre-rendered form in dev at /api/agent?route=page&kind=provider&id=…
            const agentRoutes: [RegExp, (m: RegExpExecArray) => string][] = [
                [/^\/api\/v1(?:\/([^?]*))?(?:\?|$)/, (m) => `route=v1&path=${m[1] ?? ''}`],
                [/^\/(?:api\/)?mcp(?:\?|$)/, () => 'route=mcp'],
                [/^\/openapi\.json(?:\?|$)/, () => 'route=openapi'],
                [/^\/llms\.txt(?:\?|$)/, () => 'route=llms'],
                [/^\/llms-full\.txt(?:\?|$)/, () => 'route=llms-full'],
                [/^\/sitemap\.xml(?:\?|$)/, () => 'route=sitemap'],
                [/^\/sitemaps\/([^?]+)(?:\?|$)/, (m) => `route=sitemap&name=${m[1]}`],
            ]
            server.middlewares.use((req, res, next) => {
                const url = req.url ?? ''
                for (const [pattern, toQuery] of agentRoutes) {
                    const m = pattern.exec(url)
                    if (!m) continue
                    const rest = url.includes('?') ? url.slice(url.indexOf('?') + 1) : ''
                    req.url = `/api/agent?${toQuery(m)}${rest ? `&${rest}` : ''}`
                    server
                        .ssrLoadModule('/api/agent.ts')
                        .then((mod) => mod.default(req, withVercelHelpers(res)))
                        .catch(next)
                    return
                }
                next()
            })
            server.middlewares.use((req, res, next) => {
                // Same shim serves every dev-mapped function (api/<name>.ts).
                const match = /^\/api\/(place-photo|inquiry|ai-search|forum-notify|agent)(?:[/?]|$)/.exec(req.url ?? '')
                if (!match) return next()

                server
                    .ssrLoadModule(`/api/${match[1]}.ts`)
                    .then((mod) => mod.default(req, withVercelHelpers(res)))
                    .catch(next)
            })
        },
    }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
    plugins: [react(), placePhotoDevMiddleware(mode)],
    define: {
        // Stamped into src/utils/providerCache.ts so every deploy invalidates
        // the IndexedDB copy of the directory — a change to the row shape,
        // normalizeProvider or the Discover pins can never be served stale
        // cached rows from a previous build.
        'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(
            process.env.VERCEL_GIT_COMMIT_SHA || String(Date.now()),
        ),
    },
    server: {
        host: true,
        port: 5174,
    },
}))
