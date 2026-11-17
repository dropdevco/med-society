/** Spike only: proves a function in api/ can import a pure module from shared/. */
export function fold(s: string): string {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
