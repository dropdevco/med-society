/**
 * The weekly slot every source runs in, computed in a named time zone so
 * "Monday 06:00 in Mexico City" stays Monday 06:00 there whatever the server's
 * clock or the US daylight-saving dates do. Pure: the scheduler and the
 * dashboard both use it.
 */

export interface WeeklySchedule {
    /** 0 = Sunday … 6 = Saturday. */
    day: number;
    /** 24-hour "HH:MM" in `timeZone`. */
    time: string;
    /** IANA zone, e.g. "America/Mexico_City". */
    timeZone: string;
}

/** Monday 06:00 in Mexico City: before the hospitals' working day. */
export const DEFAULT_SCHEDULE: WeeklySchedule = { day: 1, time: '06:00', timeZone: 'America/Mexico_City' };

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DAY_NAMES = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** SOURCES_RUN_DAY (0–6 or MON…SUN), SOURCES_RUN_TIME (HH:MM), SOURCES_TZ. Throws on nonsense rather than guessing. */
export function scheduleFromEnv(env: NodeJS.ProcessEnv = process.env): WeeklySchedule {
    const rawDay = (env.SOURCES_RUN_DAY ?? '').trim().toUpperCase();
    const day = rawDay === '' ? DEFAULT_SCHEDULE.day : /^\d$/.test(rawDay) ? Number(rawDay) : DAYS.indexOf(rawDay.slice(0, 3));
    const time = (env.SOURCES_RUN_TIME ?? DEFAULT_SCHEDULE.time).trim();
    const timeZone = (env.SOURCES_TZ ?? DEFAULT_SCHEDULE.timeZone).trim();
    if (day < 0 || day > 6) throw new Error(`SOURCES_RUN_DAY must be 0-6 or MON..SUN, got "${env.SOURCES_RUN_DAY}"`);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`SOURCES_RUN_TIME must be HH:MM, got "${time}"`);
    new Intl.DateTimeFormat('en-US', { timeZone }); // throws RangeError on an unknown zone
    return { day, time, timeZone };
}

export const describeSchedule = (s: WeeklySchedule) => `${DAY_NAMES[s.day]} at ${s.time} (${s.timeZone})`;

const formatters = new Map<string, Intl.DateTimeFormat>();
function wallClock(ms: number, timeZone: string) {
    let f = formatters.get(timeZone);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
        formatters.set(timeZone, f);
    }
    const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** The UTC instant at which `timeZone`'s clock reads y-m-d h:mi. */
function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, timeZone: string): number {
    const target = Date.UTC(y, m - 1, d, h, mi);
    let t = target;
    for (let i = 0; i < 3; i++) {
        const w = wallClock(t, timeZone);
        const shown = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi);
        if (shown === target) break;
        t += target - shown;
    }
    return t;
}

function slot(now: number, s: WeeklySchedule, direction: 1 | -1): number {
    const [hh, mm] = s.time.split(':').map(Number);
    const today = wallClock(now, s.timeZone);
    for (let i = 0; i <= 8; i++) {
        const civil = new Date(Date.UTC(today.y, today.m - 1, today.d + direction * i));
        if (civil.getUTCDay() !== s.day) continue;
        const t = zonedToUtc(civil.getUTCFullYear(), civil.getUTCMonth() + 1, civil.getUTCDate(), hh, mm, s.timeZone);
        if (direction === 1 ? t > now : t <= now) return t;
    }
    throw new Error('no weekly slot found'); // unreachable for a valid schedule
}

/** The first slot strictly after `now`. */
export const nextRunAt = (now: number, s: WeeklySchedule) => slot(now, s, 1);
/** The most recent slot at or before `now`. */
export const previousRunAt = (now: number, s: WeeklySchedule) => slot(now, s, -1);
