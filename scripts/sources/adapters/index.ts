/** Every source the pipeline can run. Add a source here after its row in docs/sources/README.md. */
import type { SourceAdapter } from '../lib/types';
import { hospitalAngeles } from './hospital-angeles';

export const ADAPTERS: Record<string, SourceAdapter> = {
    [hospitalAngeles.slug]: hospitalAngeles,
};
