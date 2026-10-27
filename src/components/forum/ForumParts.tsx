import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { ForumAuthorClinic, ForumThread } from '../../lib/forum';
import type { Provider } from '../../types/provider';
import { SpecialtyLabels, type Specialty } from '../../types/provider';
import { ClinicAvatar } from '../account/ClinicAvatar';
import { LogoMark } from '../brand/Logo';
import { IconVerified, IconReviews } from '../icons/Icons';
import { timeAgo } from '../../utils/timeAgo';
import './forum.css';

const SPECIALTIES = Object.keys(SpecialtyLabels) as Specialty[];

/**
 * Who wrote a post. Three shapes, deliberately unequal:
 *   - a clinician gets their listing — picture, name linked to their profile,
 *     a verified mark and their specialty. That link is the marketing a
 *     doctor earns by answering, so it is the loudest of the three.
 *   - a team prompt is signed by MedSociety.
 *   - a patient is a first name and initials, and nothing that links anywhere.
 */
export function AuthorLine({ name, clinic, isPrompt = false, at, small = false }: {
    name: string;
    clinic?: ForumAuthorClinic | null;
    isPrompt?: boolean;
    at: string;
    small?: boolean;
}) {
    const { t, i18n } = useTranslation();
    const size = small ? 30 : 40;
    const when = <span className="forum-when">{timeAgo(at, i18n.language)}</span>;

    if (isPrompt) {
        return (
            <div className="forum-author">
                <span className="forum-author-mark" style={{ width: size, height: size }}><LogoMark size={size - 10} /></span>
                <div className="forum-author-text">
                    <strong>{t('forum.teamName')}</strong>
                    <span>{t('forum.teamPrompt')} · {when}</span>
                </div>
            </div>
        );
    }

    if (clinic) {
        const specialty = clinic.specialty?.[0];
        return (
            <div className="forum-author">
                <Link to={`/providers/${clinic.id}`} aria-hidden="true" tabIndex={-1}>
                    <ClinicAvatar src={clinic.imageUrl} name={clinic.name} size={size} />
                </Link>
                <div className="forum-author-text">
                    <strong>
                        <Link to={`/providers/${clinic.id}`} className="forum-author-link">{clinic.name}</Link>
                        <span className="forum-verified" title={t('forum.verifiedClinician')}>
                            <IconVerified size={15} />
                            {!small && t('forum.verifiedClinician')}
                        </span>
                    </strong>
                    <span>
                        {[specialty && t(`specialties.${specialty}`, { defaultValue: specialty }), clinic.city]
                            .filter(Boolean).join(' · ')}
                        {' · '}{when}
                    </span>
                </div>
            </div>
        );
    }

    return (
        <div className="forum-author">
            <ClinicAvatar name={name} size={size} />
            <div className="forum-author-text">
                <strong>{name}</strong>
                <span>{when}</span>
            </div>
        </div>
    );
}

export function SpecialtyTag({ specialty }: { specialty: string | null }) {
    const { t } = useTranslation();
    if (!specialty) return null;
    return <span className="forum-tag">{t(`specialties.${specialty}`, { defaultValue: specialty })}</span>;
}

export function SpecialtySelect({ value, onChange, allLabel, id, ariaLabel }: {
    value: string;
    onChange: (v: string) => void;
    allLabel: string;
    id?: string;
    /** For a select with no visible label of its own (a wrapping <label> already names it otherwise). */
    ariaLabel?: string;
}) {
    const { t } = useTranslation();
    return (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
            <option value="">{allLabel}</option>
            {SPECIALTIES.map((s) => <option key={s} value={s}>{t(`specialties.${s}`)}</option>)}
        </select>
    );
}

/** Which owned listing a clinician speaks as. Hidden when there is only one. */
export function PostAsSelect({ clinics, value, onChange }: {
    clinics: Provider[];
    value: string;
    onChange: (id: string) => void;
}) {
    const { t } = useTranslation();
    if (clinics.length < 2) return null;
    return (
        <label className="forum-field">
            <span>{t('forum.postAs')}</span>
            <select value={value} onChange={(e) => onChange(e.target.value)}>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
        </label>
    );
}

export function ThreadCard({ thread, to }: { thread: ForumThread; to: string }) {
    const { t } = useTranslation();
    const answered = thread.forum === 'patients' ? thread.doctor_reply_count > 0 : thread.reply_count > 0;
    return (
        <Link to={to} className={`forum-card press${thread.pinned ? ' is-pinned' : ''}`}>
            <div className="forum-card-top">
                {thread.pinned && <span className="forum-tag is-accent">{t('forum.pinned')}</span>}
                {thread.is_prompt && !thread.pinned && <span className="forum-tag is-accent">{t('forum.teamPrompt')}</span>}
                <SpecialtyTag specialty={thread.specialty} />
            </div>
            <h3 className="forum-card-title">{thread.title}</h3>
            {thread.body && <p className="forum-card-body">{thread.body}</p>}
            <div className="forum-card-foot">
                <AuthorLine name={thread.author_name} clinic={thread.clinic} isPrompt={thread.is_prompt} at={thread.created_at} small />
                <span className={`forum-count${answered ? ' is-answered' : ''}`}>
                    <IconReviews size={15} />
                    {thread.forum === 'patients'
                        ? (thread.doctor_reply_count > 0
                            ? t('forum.doctorAnswers', { count: thread.doctor_reply_count })
                            : t('forum.awaitingDoctor'))
                        : t('forum.replies', { count: thread.reply_count })}
                </span>
            </div>
        </Link>
    );
}
