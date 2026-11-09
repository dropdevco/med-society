import { createRoot } from 'react-dom/client';
import './index.css';
import i18n from './i18n';
import { SiteBriefForm } from './components/account/SiteBriefForm';
const q = new URLSearchParams(location.search);
void i18n.changeLanguage(q.get('lang') ?? 'en');
const a = (q.get('a') ?? 'stay') as 'stay';
const clinic = { id: '00000000-0000-0000-0000-000000000000', name: 'Demo', specialty: ['general'] } as never;
createRoot(document.getElementById('root')!).render(
  <div className="acct-page"><SiteBriefForm clinic={clinic} content={{ brief: { archetype: a } }} onSaved={() => {}} /></div>,
);
