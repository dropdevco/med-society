// A relative import inside shared/, to prove transitive imports resolve too.
import { fold } from './fold.js';

export function spikeEcho(input: string): { input: string; folded: string; from: string } {
    return { input, folded: fold(input), from: 'shared/spike' };
}
