export const SERIES = ['var(--accent)', 'var(--us)', 'var(--star)', 'var(--red)'];

export function fmt(n: number | null | undefined): string {
    return n == null ? '–' : n.toLocaleString('en-US');
}

export function pct(a: number, b: number): string {
    return b > 0 ? `${Math.round((a / b) * 100)}%` : '–';
}

export interface BarRow { label: string; value: number; sub?: string; color?: string }
export interface Series { name: string; color: string; byDay: Map<string, number> }
