/**
 * WebMCP: the page's own tools, offered to an AI agent that is driving the
 * browser. Browsers that implement `navigator.modelContext` let a page publish
 * named, typed actions, so an agent can search the directory with one call
 * instead of clicking through the search box and the filter dialog.
 *
 * Feature-detected and entirely optional: where the API does not exist (today,
 * almost everywhere) this does nothing, and nothing else in the app depends on
 * it. The tools are thin wrappers over the same public JSON API that
 * /llms.txt and /mcp describe, so an agent sees identical data either way —
 * and the ones that search also move the visible page to the matching results,
 * so the person watching sees what their agent is looking at.
 */

interface ToolResult { content: { type: 'text'; text: string }[] }

interface WebMcpTool {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    annotations?: { readOnlyHint?: boolean };
    execute: (input: Record<string, unknown>) => Promise<ToolResult>;
}

interface ModelContext {
    registerTool?: (tool: WebMcpTool) => unknown;
    unregisterTool?: (name: string) => unknown;
}

const REGIONS = ['elpaso-juarez', 'sandiego-tijuana'];

const text = (value: unknown): ToolResult => ({
    content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
});

async function api(path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(path, init);
    // The API answers errors as JSON with a message the agent can act on.
    return res.json().catch(() => ({ ok: false, error: { code: 'bad_response', message: `HTTP ${res.status}` } }));
}

/** The website's own URL for the same search, so the visible page follows the tool call. */
function searchUrl(input: Record<string, unknown>): string {
    const sp = new URLSearchParams();
    const set = (key: string, value: unknown) => {
        if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
    };
    set('region', input.region);
    set('q', input.q);
    set('spec', input.specialty);
    set('country', input.country);
    set('rating', input.min_rating);
    set('lang', input.language);
    if (input.licensed_only === true) sp.set('verified', '1');
    if (input.max_price_mxn) {
        sp.set('priced', '1');
        set('max', input.max_price_mxn);
    }
    set('sort', input.sort);
    sp.set('list', '1');
    return `/?${sp.toString()}`;
}

function buildTools(navigate: (to: string) => void, lang: string): WebMcpTool[] {
    const uiLang = lang.toLowerCase().startsWith('es') ? 'es' : 'en';
    return [
        {
            name: 'search_providers',
            description: 'Search the MedSociety directory of health providers in El Paso – Ciudad Juárez and San Diego – Tijuana and show the results on the page. Returns providers with rating (null = unrated; check rating.count), published prices in MXN, stated languages and whether the listing is a paid placement (listing.sponsored). Use get_provider for a provider\'s services and contact details.',
            annotations: { readOnlyHint: true },
            inputSchema: {
                type: 'object',
                properties: {
                    region: { type: 'string', enum: REGIONS, description: 'Border region; omit to search both.' },
                    q: { type: 'string', description: 'Free text: a name, a kind of doctor in English or Spanish, a procedure, a city or an insurer.' },
                    specialty: { type: 'string', description: 'Specialty id, e.g. dentist, orthodontist, plastic_surgery, pediatrics, cardiology, mental_health.' },
                    country: { type: 'string', enum: ['US', 'MX'] },
                    min_rating: { type: 'number', minimum: 0, maximum: 5 },
                    language: { type: 'string', description: 'Language the clinic has stated it speaks, ISO code (en, es).' },
                    licensed_only: { type: 'boolean', description: 'Only providers with a published professional licence.' },
                    max_price_mxn: { type: 'number', description: 'Price ceiling in Mexican pesos.' },
                    sort: { type: 'string', enum: ['relevance', 'rating', 'reviews', 'price'] },
                    limit: { type: 'integer', minimum: 1, maximum: 50 },
                },
            },
            async execute(input) {
                const sp = new URLSearchParams({ lang: uiLang });
                for (const [k, v] of Object.entries(input)) {
                    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
                }
                const result = await api(`/api/v1/providers?${sp.toString()}`);
                navigate(searchUrl(input));
                return text(result);
            },
        },
        {
            name: 'get_provider',
            description: 'Full profile of one provider by id (from search_providers): services with published prices in MXN, phone, website, social links, description and photos.',
            annotations: { readOnlyHint: true },
            inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Provider id (UUID).' } } },
            async execute(input) {
                return text(await api(`/api/v1/providers/${encodeURIComponent(String(input.id ?? ''))}?lang=${uiLang}`));
            },
        },
        {
            name: 'open_provider',
            description: 'Show a provider\'s profile page to the person using the browser.',
            inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Provider id (UUID).' } } },
            async execute(input) {
                const id = String(input.id ?? '');
                if (!/^[0-9a-f-]{36}$/i.test(id)) {
                    return text({ ok: false, error: { code: 'invalid_parameter', message: 'id must be a provider UUID.' } });
                }
                navigate(`/providers/${id}`);
                return text({ ok: true, opened: `/providers/${id}` });
            },
        },
        {
            name: 'find_care_for_symptoms',
            description: 'Describe a health problem in plain English or Spanish and show the page\'s own symptom search for it: it suggests which kinds of doctor usually handle it and lists doctors whose patients reviewed similar problems. Read the answer from the page afterwards. Not a diagnosis; if it looks like an emergency, tell the person to call 911 now.',
            inputSchema: {
                type: 'object', required: ['query', 'region'],
                properties: {
                    query: { type: 'string', description: 'What is wrong, in the person\'s words.' },
                    region: { type: 'string', enum: REGIONS },
                },
            },
            async execute(input) {
                const sp = new URLSearchParams({ region: String(input.region ?? ''), q: String(input.query ?? ''), smart: '1', list: '1' });
                navigate(`/?${sp.toString()}`);
                return text({ ok: true, opened: 'symptom search', note: 'The result appears on the page in a few seconds. Read it from there.' });
            },
        },
    ];
}

/** Publish the tools; returns a function that withdraws them. A no-op where WebMCP is absent. */
export function registerAgentTools(navigate: (to: string) => void, lang: string): () => void {
    const mc = (navigator as Navigator & { modelContext?: ModelContext }).modelContext;
    if (!mc || typeof mc.registerTool !== 'function') return () => {};
    const names: string[] = [];
    for (const tool of buildTools(navigate, lang)) {
        try {
            mc.registerTool(tool);
            names.push(tool.name);
        } catch {
            // An already-registered name or an unsupported shape: the page works without the tool.
        }
    }
    return () => {
        for (const name of names) {
            try { mc.unregisterTool?.(name); } catch { /* already gone */ }
        }
    };
}
