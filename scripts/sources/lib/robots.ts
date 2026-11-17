/**
 * A small robots.txt reader (RFC 9309): the group for our token if there is
 * one, otherwise `*`; longest matching rule wins; Allow wins a tie; `*` and
 * `$` work as wildcards. Checked before every run, not once at build time.
 */
import { politeGet, ROBOTS_TOKEN } from './http';

interface Rule {
    allow: boolean;
    pattern: string;
}

function groupsOf(text: string): Map<string, Rule[]> {
    const groups = new Map<string, Rule[]>();
    let agents: string[] = [];
    let collectingAgents = false;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.replace(/#.*$/, '').trim();
        const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
        if (!m) continue;
        const field = m[1].toLowerCase();
        const value = m[2].trim();
        if (field === 'user-agent') {
            if (!collectingAgents) agents = [];
            agents.push(value.toLowerCase());
            collectingAgents = true;
            for (const a of agents) if (!groups.has(a)) groups.set(a, []);
            continue;
        }
        collectingAgents = false;
        if ((field === 'allow' || field === 'disallow') && agents.length) {
            // An empty Disallow means "nothing is disallowed".
            if (field === 'disallow' && value === '') continue;
            for (const a of agents) groups.get(a)!.push({ allow: field === 'allow', pattern: value });
        }
    }
    return groups;
}

function matches(pattern: string, path: string): boolean {
    const anchored = pattern.endsWith('$');
    const body = anchored ? pattern.slice(0, -1) : pattern;
    const re = body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
    return new RegExp(`^${re}${anchored ? '$' : ''}`).test(path);
}

/** Is `pathAndQuery` (e.g. "/tijuana/directorio-medico") allowed for `token`? */
export function isAllowed(robotsTxt: string, token: string, pathAndQuery: string): boolean {
    const groups = groupsOf(robotsTxt);
    const rules = groups.get(token.toLowerCase()) ?? groups.get('*') ?? [];
    let best: Rule | null = null;
    for (const rule of rules) {
        if (!matches(rule.pattern, pathAndQuery)) continue;
        const longer = !best || rule.pattern.length > best.pattern.length;
        const tieAllow = best && rule.pattern.length === best.pattern.length && rule.allow;
        if (longer || tieAllow) best = rule;
    }
    return best ? best.allow : true;
}

/**
 * Fetch the site's robots.txt and check each URL. A missing file (404/410)
 * means no rules. Any other failure counts as "not allowed": when in doubt,
 * a person asks the organization instead.
 */
export async function robotsVerdict(urls: string[]): Promise<{ allowed: boolean; reason?: string }> {
    const byOrigin = new Map<string, string[]>();
    for (const u of urls) {
        const { origin } = new URL(u);
        byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), u]);
    }
    for (const [origin, list] of byOrigin) {
        let text = '';
        try {
            const res = await politeGet(`${origin}/robots.txt`, [404, 410]);
            if (res.status === 200) text = res.body;
        } catch (err) {
            return { allowed: false, reason: `could not read ${origin}/robots.txt (${(err as Error).message})` };
        }
        for (const u of list) {
            const { pathname, search } = new URL(u);
            if (!isAllowed(text, ROBOTS_TOKEN, pathname + search)) {
                return { allowed: false, reason: `robots.txt disallows ${pathname + search} for ${ROBOTS_TOKEN}` };
            }
        }
    }
    return { allowed: true };
}
