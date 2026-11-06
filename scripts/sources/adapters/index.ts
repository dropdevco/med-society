/**
 * Every source the pipeline can run, in run order. Add a source here after its
 * row in docs/sources/README.md. CONACEM looks up the doctors the hospital
 * sources list, so it runs after them.
 */
import type { SourceAdapter } from '../lib/types';
import { conacem } from './conacem';
import { hospitalAngeles } from './hospital-angeles';
import { starMedica } from './starmedica';

export const ADAPTERS: Record<string, SourceAdapter> = {
    [hospitalAngeles.slug]: hospitalAngeles,
    [starMedica.slug]: starMedica,
    [conacem.slug]: conacem,
};
