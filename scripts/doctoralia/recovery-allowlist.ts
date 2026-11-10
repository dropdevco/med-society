/**
 * Hand-picked recovery houses that promote-google.ts may insert for the
 * `*-recovery` targets (see docs/recovery-centers-plan.md, section 4).
 *
 * Only the "clear" names: the name says recovery house/home/center and the place
 * is a stay. The "possible" ones are deliberately absent until someone has
 * looked at their Maps page or website. place_ids were checked against the
 * staging tables (google_places_tijuana / google_places_juarez); the name is a
 * label for the dry-run output only, the id decides.
 */
export interface AllowedPlace {
  placeId: string;
  name: string;
}

export const RECOVERY_ALLOWLIST: Record<'tijuana-recovery' | 'juarez-recovery', AllowedPlace[]> = {
  'tijuana-recovery': [
    { placeId: 'ChIJBctCOOc32YARwRKB51EGcTs', name: 'Bella Recovery House' },
    { placeId: 'ChIJuckNdf9L2YARBWVtI24oGmI', name: 'Cocoon Recovery Home' },
    { placeId: 'ChIJTyaUqOVJ2YARTuGh2dBQ6cc', name: 'Recovery House Tijuana' },
    { placeId: 'ChIJHSzXvV1J2YARZI0Q214gikY', name: 'Zen & Healthy Recovery' },
    { placeId: 'ChIJoTiyEjUu2YARUoMalF4flJE', name: 'Dollhouse Recovery TIJUANA MEXICO' },
    { placeId: 'ChIJTd-JxvVH2YARR2SkiCFiL4Y', name: 'Luma Recovery House' },
    { placeId: 'ChIJd4oXFIE32YARvmxHOxehFVo', name: 'Princess palace recovery' },
    { placeId: 'ChIJe0EF-TJJ2YARdnIOBcfIjGw', name: 'Palmas Recovery' },
    { placeId: 'ChIJ_Z1oQrY32YAROJtEgySbNnc', name: 'Epione Recovery House' },
    { placeId: 'ChIJJzrLbslL2YARsYZ3E6tCbn4', name: 'eva surgery recovery house' },
    { placeId: 'ChIJ272FOwBJ2YARXngL4suPq2o', name: 'RECOVERY HOUSE VIVE' },
    { placeId: 'ChIJVWj9FgBH2YARDqr7-SkXbZI', name: 'Bella Luna Recovery Home & Spa' },
    { placeId: 'ChIJ5fsTXCdJ2YARyeOgSW1nyVk', name: 'RECOVERY BOUTIQUE' },
    { placeId: 'ChIJF-N2Uv5L2YARNOqx1EGrOv4', name: 'Recovery House LULUK' },
    { placeId: 'ChIJv-JuNQRJ2YARxjwwNjpWlKo', name: 'Top Doctors recovery house and Spa' },
    { placeId: 'ChIJ0VspYgA52YAR2POMi3e7HJg', name: 'Excellence Recovery House' },
    { placeId: 'ChIJEfWwrRhL2YARczg6dy6oN6o', name: 'Phoenix Recovery Home' },
    { placeId: 'ChIJd0UDMDc32YARGak0_nD7ljo', name: 'SALUS surgery recovery' },
    { placeId: 'ChIJnUjq6hxJ2YARDTahm_7h6BE', name: 'Bloom Recovery House' },
    { placeId: 'ChIJARwu4x1I2YARqhydtvV2MJk', name: 'Beauty Care Recovery House' },
  ],
  'juarez-recovery': [
    { placeId: 'ChIJF7lv9Mtb54YRORA0v40B7ho', name: 'Casa Nefertiti - Recovery Home' },
  ],
};

/** Normalisers that mirror public.bh_norm / public.bh_phone (migration 0005), for the providers dedupe. */
const STOP = new Set(
  ('dr dra doctor doctora lic mtro mtra clinica clinicas consultorio centro medico medica medicos hospital salud grupo ' +
    'especialidades dental dentista odontologia de del la el los las y en sa cv s a c v clinic clinics medical center ' +
    'centre family health care group services the of at and pllc llc pa md dds inc').split(' '),
);

export function nameNorm(t: string | null | undefined): string {
  const base = (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  return base.split(' ').filter((w) => w && !STOP.has(w)).join(' ');
}

export function phoneNorm(t: string | null | undefined): string | null {
  const d = (t ?? '').replace(/\D/g, '').slice(-10);
  return d || null;
}
