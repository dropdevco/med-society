/**
 * Shapes shared by the source pipeline (docs/adr/0001). An adapter knows one
 * site; everything else (fetching, robots, judging, snapshots) is the core's.
 */

/** Same ids as src/utils/region.ts. A copy, because scripts/ runs without the app. */
export type RegionId = 'elpaso-juarez' | 'sandiego-tijuana';

export type OrganizationKind = 'hospital' | 'consejo' | 'colegio' | 'association' | 'regulator' | 'accreditor';

/** One page the adapter reads per run. */
export interface Target {
    key: string;
    label: string;
    url: string;
    region: RegionId;
}

/** Where a listed doctor practises, as the source shows it. */
export interface EntrySite {
    name: string;
    address: string | null;
    tower: string | null;
    office: string | null;
}

/** One doctor (or facility) a source publishes, normalised across sources. */
export interface SourceEntry {
    /** The source's own stable key: a slug, a cédula, a register number. */
    externalId: string;
    name: string;
    /** "Dr.", "Dra." when the source prints one; kept apart from the name for matching. */
    title: string | null;
    specialties: string[];
    /** Cédula numbers when the source shows them: the match key (docs/adr/0004). */
    cedulas: string[];
    sites: EntrySite[];
    region: RegionId;
    url: string;
    photoUrl: string | null;
}

/**
 * An entry as one run saw it. Every record the pipeline keeps carries the run
 * that produced it, so any row can be traced back to its run, however large
 * the history grows.
 */
export interface ObservedEntry extends SourceEntry {
    /** The run's UUIDv7. */
    runId: string;
    /** When the page this entry came from was fetched (ISO 8601, UTC). */
    observedAt: string;
}

/** What a permission letter allows. Never the letter itself or the signers' names. */
export interface Permission {
    grantedOn: string;
    scope: string;
    conditions: string;
    /** Where the signed copy is kept. */
    reference: string;
}

export interface SourceAdapter {
    slug: string;
    name: string;
    kind: OrganizationKind;
    /** docs/adr/0002: only `open`, or `permission` with the letter recorded. */
    access: 'open' | 'permission';
    permission?: Permission;
    targets: Target[];
    parse(html: string, target: Target): SourceEntry[];
}
