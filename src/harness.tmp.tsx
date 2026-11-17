import { createRoot } from 'react-dom/client';
import './index.css';
import i18n from './i18n';
import { ClinicSitePanel } from './components/account/ClinicSitePanel';
const q = new URLSearchParams(location.search);
void i18n.changeLanguage(q.get('lang') ?? 'en');
const full = q.get('full') === '1';
const clinic = {
  id: '00000000-0000-0000-0000-000000000000', name: 'Demo', specialty: [q.get('s') ?? 'cardiology'], country: 'MX', city: 'Tijuana',
  rating: 4.8, reviewCount: 36, languages: ['es', 'en'], languagesConfirmed: full, licensed: full, website: undefined,
  phone: q.get('phone') === '0' ? undefined : '+52 664 555 0100', socials: q.get('wa') === '1' ? { whatsapp: 'https://wa.me/526645550100' } : {},
  insurances: full ? ['GNP Seguros', 'AXA', 'Metlife', 'Seguros Monterrey'] : [],
  services: full ? [{ name: 'Consulta cardiológica' }, { name: 'Ecocardiograma' }, { name: 'Prueba de esfuerzo' }, { name: 'Holter' }] : [],
} as never;
createRoot(document.getElementById('root')!).render(
  <div className="acct-page"><ClinicSitePanel clinic={clinic} site={{ subdomain: 'demo', status: 'preview', content: {} }} onSaved={() => {}} onEditProfile={(f) => console.log('edit', f)} /></div>,
);
