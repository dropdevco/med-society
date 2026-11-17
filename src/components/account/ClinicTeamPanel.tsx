import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Provider } from '../../types/provider';
import { SpecialtyLabels } from '../../types/provider';
import {
    teamOverview, sendInvite, revokeInvite, setMemberRole, removeMember,
    searchDirectory, linkPractitioner, createPractitioner, unlinkPractitioner,
    updatePractitionerLink, dismissSuggestion, sendLinkNotice,
    type TeamOverview, type TeamRole, type DirectoryMatch, type TeamPractitioner, type TeamSuggestion,
} from '../../lib/team';
import { ClinicAvatar } from './ClinicAvatar';
import { useToast } from './toastContext';

/**
 * The Team tab: who runs this listing, the specialists who practise here, and
 * (when this listing is itself a specialist) the clinics it is part of.
 *
 * Front-desk staff can do almost everything here: invite staff, add doctors,
 * edit the profiles the clinic created. Only an owner changes roles, removes
 * an owner or invites one (0049). The database enforces all of it; the UI
 * only hides what would be refused. Linking a doctor never lets the clinic
 * edit their listing, and a doctor invited to their own listing still goes
 * through claim review.
 */
export function ClinicTeamPanel({ clinic, onChanged, onEdit }: {
    clinic: Provider;
    /** Something changed that alters which listings this user manages. */
    onChanged: () => void;
    /** Open a managed specialist's profile in the dashboard. */
    onEdit: (providerId: string) => void;
}) {
    const { t } = useTranslation();
    const [data, setData] = useState<TeamOverview | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Bumped to re-read after a change.
    const [version, setVersion] = useState(0);

    useEffect(() => {
        let cancelled = false;
        void teamOverview(clinic.id).then((res) => {
            if (cancelled) return;
            if (res.error) setError(res.error);
            else { setError(null); setData(res.data); }
        });
        return () => { cancelled = true; };
    }, [clinic.id, version]);

    const refresh = useCallback(() => { setVersion((v) => v + 1); onChanged(); }, [onChanged]);

    if (error && !data) {
        return <p className="acct-msg acct-msg--error acct-msg--block">{t(`team.err.${error}`, { defaultValue: t('team.err.unknown') })}</p>;
    }
    if (!data) return <p className="acct-muted">{t('account.loading')}</p>;

    return (
        <div className="acct-form">
            <MembersCard clinic={clinic} data={data} onChanged={refresh} />
            <SpecialistsCard clinic={clinic} data={data} onChanged={refresh} onEdit={onEdit} />
            {data.suggestions.length > 0 && <SuggestionsCard clinic={clinic} data={data} onChanged={refresh} />}
            {data.clinics.length > 0 && <ClinicsCard listing={clinic} data={data} onChanged={refresh} />}
        </div>
    );
}

// ── People who manage this listing ──────────────────────────────────────────

function MembersCard({ clinic, data, onChanged }: {
    clinic: Provider; data: TeamOverview; onChanged: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const [busy, setBusy] = useState<string | null>(null);
    const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
    const teamInvites = data.invites.filter((i) => i.provider_id === clinic.id);
    const isOwner = data.my_role === 'owner';

    const run = async (key: string, fn: () => Promise<{ error: string | null }>, ok: string) => {
        setBusy(key);
        const { error } = await fn();
        setBusy(null);
        if (error) toast(t(`team.err.${error}`, { defaultValue: t('team.err.unknown') }), 'error');
        else { toast(ok); onChanged(); }
    };

    return (
        <section className="acct-card" aria-labelledby="team-members-title">
            <div>
                <h2 id="team-members-title" className="acct-card-title">{t('team.membersTitle')}</h2>
                <p className="acct-muted">{t('team.membersBody', { name: clinic.name })}</p>
            </div>

            <ul style={listStyle}>
                {data.members.map((m) => (
                    <li key={m.user_id} style={rowStyle}>
                        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                            <strong style={ellipsis}>{m.email}</strong>
                            {m.is_me && <span className="acct-hint"> {t('team.you')}</span>}
                        </div>
                        {isOwner ? (
                            <select
                                value={m.role}
                                disabled={busy !== null}
                                aria-label={t('team.roleLabel')}
                                onChange={(e) => void run(m.user_id,
                                    () => setMemberRole(clinic.id, m.user_id, e.target.value as TeamRole),
                                    t('team.roleChanged'))}
                                style={{ width: 'auto' }}
                            >
                                <option value="owner">{t('team.role.owner')}</option>
                                <option value="staff">{t('team.role.staff')}</option>
                            </select>
                        ) : (
                            <span className="acct-hint">{t(`team.role.${m.role}`)}</span>
                        )}
                        {/* Staff may remove staff or leave; removing an owner takes an owner. */}
                        {!isOwner && m.role === 'owner' && !m.is_me ? null : confirmRemove === m.user_id ? (
                            <span className="acct-confirm">
                                {m.is_me ? t('team.leaveConfirm') : t('team.removeConfirm')}
                                <button type="button" className="acct-link acct-link--danger"
                                    onClick={() => { setConfirmRemove(null); void run(m.user_id, () => removeMember(clinic.id, m.user_id), m.is_me ? t('team.left') : t('team.removed')); }}>
                                    {t('team.yes')}
                                </button>
                                <button type="button" className="acct-link" onClick={() => setConfirmRemove(null)}>{t('team.no')}</button>
                            </span>
                        ) : (
                            <button type="button" className="acct-link acct-link--danger" disabled={busy !== null}
                                onClick={() => setConfirmRemove(m.user_id)}>
                                {m.is_me ? t('team.leave') : t('team.remove')}
                            </button>
                        )}
                    </li>
                ))}
                {teamInvites.map((i) => (
                    <li key={i.id} style={rowStyle}>
                        <div style={{ minWidth: 0, flex: '1 1 200px' }}>
                            <span style={ellipsis}>{i.email}</span>
                            <span className="acct-hint">
                                {i.expired ? t('team.inviteExpired') : t('team.invitePending')} · {t(`team.role.${i.role}`)}
                            </span>
                        </div>
                        <ResendInvite clinicId={clinic.id} email={i.email} role={i.role} onSent={onChanged} />
                        <button type="button" className="acct-link acct-link--danger" disabled={busy !== null}
                            onClick={() => void run(i.id, () => revokeInvite(i.id), t('team.inviteCancelled'))}>
                            {t('team.cancelInvite')}
                        </button>
                    </li>
                ))}
            </ul>

            <InviteForm clinicId={clinic.id} onSent={onChanged} canInviteOwner={isOwner} />
            <p className="acct-fine">{t('team.rolesExplained')}</p>
        </section>
    );
}

function InviteForm({ clinicId, providerId, onSent, compact = false, canInviteOwner = false }: {
    clinicId: string;
    /** Set for a doctor invite: they claim that listing, reviewed by our team. */
    providerId?: string;
    onSent: (link: string) => void;
    compact?: boolean;
    /** Only an owner may bring in another owner. */
    canInviteOwner?: boolean;
}) {
    const { t, i18n } = useTranslation();
    const toast = useToast();
    const [email, setEmail] = useState('');
    const [role, setRole] = useState<TeamRole>('staff');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [link, setLink] = useState<string | null>(null);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const res = await sendInvite({
            clinicId, providerId, email: email.trim(), lang: i18n.language.startsWith('en') ? 'en' : 'es',
            role: providerId ? 'owner' : role,
        });
        setBusy(false);
        if (res.error || !res.data) {
            setError(t(`team.err.${res.error}`, { defaultValue: t('team.err.unknown') }));
            return;
        }
        setLink(res.data.link);
        setEmail('');
        toast(res.data.emailed ? t('team.inviteSent') : t('team.inviteCreatedNoEmail'), res.data.emailed ? 'success' : 'error');
        onSent(res.data.link);
    };

    return (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            {!compact && <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gray-300)' }}>{t('team.inviteTitle')}</span>}
            <div className="acct-row">
                <input
                    type="email" required value={email} placeholder={t('team.emailPlaceholder')}
                    aria-label={t('team.emailPlaceholder')}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{ flex: '1 1 220px', width: 'auto' }}
                />
                {!providerId && canInviteOwner && (
                    <select value={role} onChange={(e) => setRole(e.target.value as TeamRole)}
                        aria-label={t('team.roleLabel')} style={{ width: 'auto' }}>
                        <option value="staff">{t('team.role.staff')}</option>
                        <option value="owner">{t('team.role.owner')}</option>
                    </select>
                )}
                <button type="submit" className="acct-btn acct-btn--sm" disabled={busy || !email.trim()}>
                    {busy ? t('account.working') : t('team.sendInvite')}
                </button>
            </div>
            {providerId && <p className="acct-fine">{t('team.inviteDoctorHint')}</p>}
            {error && <p className="acct-msg acct-msg--error" role="alert">{error}</p>}
            {link && <CopyLink link={link} />}
        </form>
    );
}

/** The invite link, for WhatsApp: how most clinics on the border talk. */
function CopyLink({ link }: { link: string }) {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);
    const whatsapp = `https://wa.me/?text=${encodeURIComponent(t('team.whatsappText', { link }))}`;
    return (
        <div className="acct-row" style={{ fontSize: '0.8rem' }}>
            <span className="acct-hint">{t('team.shareLink')}</span>
            <button type="button" className="acct-link" onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true));
            }}>
                {copied ? t('team.copied') : t('team.copyLink')}
            </button>
            <a className="acct-link" href={whatsapp} target="_blank" rel="noopener noreferrer">WhatsApp</a>
        </div>
    );
}

function ResendInvite({ clinicId, providerId, email, role, onSent }: {
    clinicId: string; providerId?: string; email: string; role: TeamRole; onSent: () => void;
}) {
    const { t, i18n } = useTranslation();
    const toast = useToast();
    const [busy, setBusy] = useState(false);
    const [link, setLink] = useState<string | null>(null);
    return (
        <>
            <button type="button" className="acct-link" disabled={busy} onClick={async () => {
                setBusy(true);
                const res = await sendInvite({
                    clinicId, providerId, email, role, lang: i18n.language.startsWith('en') ? 'en' : 'es',
                });
                setBusy(false);
                if (res.error || !res.data) {
                    toast(t(`team.err.${res.error}`, { defaultValue: t('team.err.unknown') }), 'error');
                    return;
                }
                setLink(res.data.link);
                toast(res.data.emailed ? t('team.inviteSent') : t('team.inviteCreatedNoEmail'), res.data.emailed ? 'success' : 'error');
                onSent();
            }}>
                {busy ? t('account.working') : t('team.resend')}
            </button>
            {link && <div style={{ flexBasis: '100%' }}><CopyLink link={link} /></div>}
        </>
    );
}

// ── Specialists who practise here ───────────────────────────────────────────

function SpecialistsCard({ clinic, data, onChanged, onEdit }: {
    clinic: Provider; data: TeamOverview; onChanged: () => void; onEdit: (id: string) => void;
}) {
    const { t } = useTranslation();
    const [adding, setAdding] = useState(false);

    return (
        <section className="acct-card" aria-labelledby="team-specialists-title">
            <div className="acct-card-head">
                <div>
                    <h2 id="team-specialists-title" className="acct-card-title">{t('team.specialistsTitle')}</h2>
                    <p className="acct-muted">{t('team.specialistsBody')}</p>
                </div>
            </div>

            {data.practitioners.length > 0 && (
                <ul style={listStyle}>
                    {data.practitioners.map((p) => (
                        <SpecialistRow
                            key={p.id} clinic={clinic} p={p}
                            invite={data.invites.find((i) => i.provider_id === p.id)}
                            onChanged={onChanged} onEdit={onEdit}
                        />
                    ))}
                </ul>
            )}

            {adding
                ? <AddSpecialist clinic={clinic} linkedIds={data.practitioners.map((p) => p.id)}
                    onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />
                : (
                    <div>
                        <button type="button" className="acct-btn acct-btn--sm acct-btn--ghost" onClick={() => setAdding(true)}>
                            + {t('team.addSpecialist')}
                        </button>
                    </div>
                )}
        </section>
    );
}

function SpecialistRow({ clinic, p, invite, onChanged, onEdit }: {
    clinic: Provider;
    p: TeamPractitioner;
    invite?: TeamOverview['invites'][number];
    onChanged: () => void;
    onEdit: (id: string) => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const [inviting, setInviting] = useState(false);
    const [confirm, setConfirm] = useState(false);
    // Kept after the form closes, so the link can still go out by WhatsApp.
    const [sentLink, setSentLink] = useState<string | null>(null);

    const status = p.link_status === 'pending'
        ? t('team.statusPending')
        : p.claimed
            ? (p.managed ? t('team.statusClaimedManaged') : t('team.statusClaimed'))
            : p.managed ? t('team.statusManaged') : t('team.statusListed');

    return (
        <li style={{ ...rowStyle, alignItems: 'flex-start' }}>
            <ClinicAvatar src={p.imageUrl ?? undefined} name={p.name} size={38} />
            <div style={{ minWidth: 0, flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
                <strong style={ellipsis}>{p.name}</strong>
                <span className="acct-hint">
                    {p.specialty.map((s) => t(`specialties.${s}`, { defaultValue: s })).join(' · ')}
                </span>
                <span className="acct-hint">{status}</span>
                {invite && !p.claimed && (
                    <span className="acct-hint">
                        {t('team.invitedAs', { email: invite.email })}
                        {invite.expired && ` · ${t('team.inviteExpired')}`}
                    </span>
                )}
                {inviting && (
                    <div style={{ marginTop: '0.5rem' }}>
                        <InviteForm compact clinicId={clinic.id} providerId={p.id}
                            onSent={(link) => { setInviting(false); setSentLink(link); onChanged(); }} />
                    </div>
                )}
                {sentLink && !inviting && <CopyLink link={sentLink} />}
            </div>
            <div className="acct-row" style={{ justifyContent: 'flex-end' }}>
                {p.managed && p.link_status === 'active' && (
                    <button type="button" className="acct-link" onClick={() => onEdit(p.id)}>{t('team.editProfile')}</button>
                )}
                {!p.claimed && p.link_status === 'active' && !inviting && (
                    invite
                        ? <ResendInvite clinicId={clinic.id} providerId={p.id} email={invite.email} role="owner" onSent={onChanged} />
                        : <button type="button" className="acct-link" onClick={() => setInviting(true)}>{t('team.inviteDoctor')}</button>
                )}
                <a className="acct-link" href={`/providers/${p.id}`} target="_blank" rel="noopener noreferrer">{t('team.view')}</a>
                {confirm ? (
                    <span className="acct-confirm">
                        {t('team.unlinkConfirm')}
                        <button type="button" className="acct-link acct-link--danger" onClick={async () => {
                            setConfirm(false);
                            const { error } = await unlinkPractitioner(clinic.id, p.id);
                            if (error) toast(t(`team.err.${error}`, { defaultValue: t('team.err.unknown') }), 'error');
                            else { toast(t('team.unlinked')); onChanged(); }
                        }}>{t('team.yes')}</button>
                        <button type="button" className="acct-link" onClick={() => setConfirm(false)}>{t('team.no')}</button>
                    </span>
                ) : (
                    <button type="button" className="acct-link acct-link--danger" onClick={() => setConfirm(true)}>{t('team.unlink')}</button>
                )}
            </div>
        </li>
    );
}

/**
 * Find the specialist in the directory first — most are there already, from
 * Doctoralia — and only then offer to create a new profile. Creating first
 * would fill the directory with second copies of the same doctor.
 */
function AddSpecialist({ clinic, linkedIds, onDone, onCancel }: {
    clinic: Provider; linkedIds: string[]; onDone: () => void; onCancel: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const [name, setName] = useState('');
    const [results, setResults] = useState<{ q: string; list: DirectoryMatch[] } | null>(null);
    const [specialty, setSpecialty] = useState<string>(clinic.specialty[0] ?? 'general');
    const [busy, setBusy] = useState(false);

    const q = name.trim();
    useEffect(() => {
        if (q.length < 3) return;
        let cancelled = false;
        const id = window.setTimeout(() => {
            void searchDirectory(q, clinic.city).then((list) => {
                if (!cancelled) setResults({ q, list: list.filter((m) => m.id !== clinic.id) });
            });
        }, 350);
        return () => { cancelled = true; window.clearTimeout(id); };
    }, [q, clinic.city, clinic.id]);

    const matches = results && results.q === q ? results.list : null;

    const link = async (m: DirectoryMatch) => {
        setBusy(true);
        const res = await linkPractitioner(clinic.id, m.id);
        setBusy(false);
        if (res.error || !res.data) {
            toast(t(`team.err.${res.error}`, { defaultValue: t('team.err.unknown') }), 'error');
            return;
        }
        toast(res.data.status === 'pending' ? t('team.linkedPending') : t('team.linked'));
        if (res.data.status === 'pending') void sendLinkNotice(clinic.id, m.id);
        onDone();
    };

    const create = async () => {
        setBusy(true);
        const res = await createPractitioner(clinic.id, q, [specialty]);
        setBusy(false);
        if (res.error) {
            toast(t(`team.err.${res.error}`, { defaultValue: t('team.err.unknown') }), 'error');
            return;
        }
        toast(t('team.created'));
        onDone();
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', paddingTop: '0.25rem' }}>
            <div className="acct-field">
                <label htmlFor="team-add-name">{t('team.searchLabel')}</label>
                <input id="team-add-name" autoFocus value={name} placeholder={t('team.searchPlaceholder')}
                    onChange={(e) => setName(e.target.value)} />
                <p className="acct-hint">{t('team.searchHint')}</p>
            </div>

            {q.length >= 3 && matches === null && <p className="acct-hint">{t('account.loading')}</p>}

            {matches && matches.length > 0 && (
                <ul style={listStyle}>
                    {matches.map((m) => {
                        const already = linkedIds.includes(m.id);
                        return (
                            <li key={m.id} style={rowStyle}>
                                <ClinicAvatar src={m.imageUrl ?? undefined} name={m.name} size={34} />
                                <div style={{ minWidth: 0, flex: '1 1 200px', display: 'flex', flexDirection: 'column' }}>
                                    <strong style={ellipsis}>{m.name}</strong>
                                    <span className="acct-hint" style={ellipsis}>
                                        {m.specialty.map((s) => t(`specialties.${s}`, { defaultValue: s })).join(' · ')} · {m.address}
                                    </span>
                                    {m.owned && <span className="acct-hint">{t('team.matchOwned')}</span>}
                                </div>
                                <button type="button" className="acct-btn acct-btn--sm" disabled={busy || already}
                                    onClick={() => void link(m)}>
                                    {already ? t('team.alreadyAdded') : t('team.addThis')}
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {matches && q.length >= 3 && (
                <div className="acct-card" style={{ background: 'transparent' }}>
                    <p className="acct-muted">
                        {matches.length > 0 ? t('team.notListedHere') : t('team.noMatches')}
                    </p>
                    <div className="acct-row">
                        <select value={specialty} onChange={(e) => setSpecialty(e.target.value)}
                            aria-label={t('team.specialtyLabel')} style={{ width: 'auto', flex: '1 1 200px' }}>
                            {Object.keys(SpecialtyLabels).map((k) => (
                                <option key={k} value={k}>{t(`specialties.${k}`, { defaultValue: k })}</option>
                            ))}
                        </select>
                        <button type="button" className="acct-btn acct-btn--sm" disabled={busy} onClick={() => void create()}>
                            {t('team.createProfile', { name: q })}
                        </button>
                    </div>
                    <p className="acct-fine">{t('team.createHint', { clinic: clinic.name })}</p>
                </div>
            )}

            <div>
                <button type="button" className="acct-link" onClick={onCancel}>{t('team.done')}</button>
            </div>
        </div>
    );
}

// ── Doctors a source says practise here ─────────────────────────────────────

/**
 * Doctoralia lists these doctors at an address with this clinic's name. Nothing
 * shows publicly until someone on the team adds them; "Not here" hides one.
 */
function SuggestionsCard({ clinic, data, onChanged }: {
    clinic: Provider; data: TeamOverview; onChanged: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const [busy, setBusy] = useState<string | null>(null);

    const add = async (s: TeamSuggestion) => {
        setBusy(s.id);
        const res = await linkPractitioner(clinic.id, s.id);
        setBusy(null);
        if (res.error || !res.data) {
            toast(t(`team.err.${res.error}`, { defaultValue: t('team.err.unknown') }), 'error');
            return;
        }
        toast(res.data.status === 'pending' ? t('team.linkedPending') : t('team.linked'));
        if (res.data.status === 'pending') void sendLinkNotice(clinic.id, s.id);
        onChanged();
    };
    const dismiss = async (s: TeamSuggestion) => {
        setBusy(s.id);
        const { error } = await dismissSuggestion(clinic.id, s.id);
        setBusy(null);
        if (error) toast(t(`team.err.${error}`, { defaultValue: t('team.err.unknown') }), 'error');
        else onChanged();
    };

    return (
        <section className="acct-card" aria-labelledby="team-suggest-title">
            <div>
                <h2 id="team-suggest-title" className="acct-card-title">{t('team.suggestTitle', { count: data.suggestions.length })}</h2>
                <p className="acct-muted">{t('team.suggestBody')}</p>
            </div>
            <ul style={listStyle}>
                {data.suggestions.map((s) => (
                    <li key={s.id} style={rowStyle}>
                        <ClinicAvatar src={s.imageUrl ?? undefined} name={s.name} size={34} />
                        <div style={{ minWidth: 0, flex: '1 1 200px', display: 'flex', flexDirection: 'column' }}>
                            <strong style={ellipsis}>{s.name}</strong>
                            <span className="acct-hint" style={ellipsis}>
                                {s.specialty.map((k) => t(`specialties.${k}`, { defaultValue: k })).join(' · ')}
                            </span>
                            {s.evidence.clinic_name && (
                                <span className="acct-hint" style={ellipsis}>
                                    {t('team.suggestWhy', { clinic: s.evidence.clinic_name, street: s.evidence.street ?? '' })}
                                </span>
                            )}
                            {s.claimed && <span className="acct-hint">{t('team.matchOwned')}</span>}
                        </div>
                        <button type="button" className="acct-btn acct-btn--sm" disabled={busy !== null} onClick={() => void add(s)}>
                            {t('team.addThis')}
                        </button>
                        <button type="button" className="acct-link" disabled={busy !== null} onClick={() => void dismiss(s)}>
                            {t('team.notHere')}
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

// ── Clinics this listing practises at ───────────────────────────────────────

function ClinicsCard({ listing, data, onChanged }: {
    listing: Provider; data: TeamOverview; onChanged: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();

    const act = async (fn: () => Promise<{ error: string | null }>, ok: string) => {
        const { error } = await fn();
        if (error) toast(t(`team.err.${error}`, { defaultValue: t('team.err.unknown') }), 'error');
        else { toast(ok); onChanged(); }
    };

    return (
        <section className="acct-card" aria-labelledby="team-clinics-title">
            <div>
                <h2 id="team-clinics-title" className="acct-card-title">{t('team.clinicsTitle')}</h2>
                <p className="acct-muted">{t('team.clinicsBody')}</p>
            </div>
            <ul style={listStyle}>
                {data.clinics.map((c) => (
                    <li key={c.id} style={rowStyle}>
                        <div style={{ minWidth: 0, flex: '1 1 200px', display: 'flex', flexDirection: 'column' }}>
                            <strong style={ellipsis}>{c.name}</strong>
                            <span className="acct-hint">
                                {c.city}{c.link_status === 'pending' && ` · ${t('team.clinicWantsYou')}`}
                            </span>
                        </div>
                        {c.link_status === 'pending' ? (
                            <>
                                <button type="button" className="acct-btn acct-btn--sm"
                                    onClick={() => void act(() => updatePractitionerLink(c.id, listing.id, { accept: true }), t('team.joined'))}>
                                    {t('team.accept')}
                                </button>
                                <button type="button" className="acct-link"
                                    onClick={() => void act(() => updatePractitionerLink(c.id, listing.id, { accept: false }), t('team.declined'))}>
                                    {t('team.decline')}
                                </button>
                            </>
                        ) : (
                            <>
                                <label className="acct-confirm" style={{ cursor: 'pointer' }}>
                                    <input type="checkbox" checked={c.managed} style={{ width: 'auto' }}
                                        onChange={(e) => void act(
                                            () => updatePractitionerLink(c.id, listing.id, { managed: e.target.checked }),
                                            t('team.managedSaved'))} />
                                    {t('team.letClinicEdit')}
                                </label>
                                <button type="button" className="acct-link acct-link--danger"
                                    onClick={() => void act(() => unlinkPractitioner(c.id, listing.id), t('team.leftClinic'))}>
                                    {t('team.leaveClinic')}
                                </button>
                            </>
                        )}
                    </li>
                ))}
            </ul>
        </section>
    );
}

const listStyle: React.CSSProperties = {
    listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem',
};
const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem',
    padding: '0.7rem 0.8rem', borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border)', background: 'var(--navy)',
};
const ellipsis: React.CSSProperties = {
    display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};
