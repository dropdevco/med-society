/**
 * Every source the pipeline can run, in run order. Add a source here after its
 * row in docs/sources/README.md. CONACEM looks up the doctors the hospital
 * sources list, so it runs after them. COEPRIS links to the Padrón's pages and the
 * Padrón matches on COEPRIS's numbers, so COEPRIS loads first and uses the Padrón's
 * previous run: a first run links to COEPRIS's own page, later runs to the Padrón.
 */
import type { SourceAdapter } from '../lib/types';
import { bajaHealthCluster } from './baja-health-cluster';
import { coeprisBc } from './coepris-bc';
import { conacem } from './conacem';
import { hospitalAngeles } from './hospital-angeles';
import { padronSaludBc } from './padron-salud-bc';
import { starMedica } from './starmedica';

export const ADAPTERS: Record<string, SourceAdapter> = {
    [hospitalAngeles.slug]: hospitalAngeles,
    [starMedica.slug]: starMedica,
    [conacem.slug]: conacem,
    [coeprisBc.slug]: coeprisBc,
    [padronSaludBc.slug]: padronSaludBc,
    [bajaHealthCluster.slug]: bajaHealthCluster,
};
