import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GUIDE, OFFICIAL_LINKS, guideFor } from '../utils/gettingHere';
import { isRegionId, readLastRegion, REGIONS, writeLastRegion, type RegionId } from '../utils/region';
import { IconPlane } from '../components/icons/Icons';

/**
 * /getting-here?region=…: which airport, how to cross, what to bring, for a
 * patient travelling to a region's clinics. Static, bilingual, no fares and no
 * tracking links: the plan is docs/booking-affiliate.md (F2).
 */
export function GettingHerePage() {
    const { i18n } = useTranslation();
    const lang = i18n.language.startsWith('es') ? 'es' : 'en';
    const [params, setParams] = useSearchParams();
    const fromUrl = params.get('region');
    const region: RegionId = isRegionId(fromUrl) ? fromUrl : readLastRegion();
    const city = REGIONS[region].mx.city;
    const usCity = REGIONS[region].us.city;
    const { airports, crossings } = guideFor(region, lang);

    useEffect(() => { writeLastRegion(region); }, [region]);
    useEffect(() => {
        const prev = document.title;
        document.title = `${GUIDE.title(city)[lang]} | MedSociety`;
        return () => { document.title = prev; };
    }, [city, lang]);

    const other = (Object.keys(REGIONS) as RegionId[]).filter((r) => r !== region);
    const switchRegion = (r: RegionId) => { const p = new URLSearchParams(params); p.set('region', r); setParams(p, { replace: true }); };

    return (
        <main id="main-content" className="ms-hotels-page ms-guide">
            <header className="ms-hotels-hero">
                <h1>{GUIDE.title(city)[lang]}</h1>
                <p>{GUIDE.intro(city)[lang]}</p>
                <div className="ms-hotels-regions" role="group" aria-label={REGIONS[region].name}>
                    {(Object.keys(REGIONS) as RegionId[]).map((r) => (
                        <button key={r} type="button" className={r === region ? 'on' : ''} aria-pressed={r === region} onClick={() => switchRegion(r)}>
                            {REGIONS[r].mx.city}
                        </button>
                    ))}
                </div>
            </header>

            <section className="ms-guide-sec" aria-labelledby="g-airports">
                <h2 id="g-airports">{GUIDE.airportsTitle[lang]}</h2>
                <ul className="ms-guide-airports">
                    {airports.map((a) => (
                        <li key={a.code}>
                            <IconPlane size={20} />
                            <div>
                                <b>{a.city[lang]} <span className="ms-airport-code">{a.code}</span></b>
                                <p>{a.next[lang]}</p>
                            </div>
                        </li>
                    ))}
                </ul>
            </section>

            <section className="ms-guide-sec" aria-labelledby="g-cross">
                <h2 id="g-cross">{GUIDE.crossTitle[lang]}</h2>
                <p>{GUIDE.cross(crossings, city)[lang]}</p>
                <p><a href={OFFICIAL_LINKS.cbpWaits} target="_blank" rel="noopener noreferrer">{GUIDE.waitsLink[lang]}</a></p>
            </section>

            <section className="ms-guide-sec" aria-labelledby="g-bring">
                <h2 id="g-bring">{GUIDE.bringTitle[lang]}</h2>
                <ul>
                    {GUIDE.bring.map((b, i) => (
                        <li key={i}>
                            {b.text[lang]}
                            {b.href && <> <a href={b.href} target="_blank" rel="noopener noreferrer">↗</a></>}
                        </li>
                    ))}
                </ul>
            </section>

            {region === 'sandiego-tijuana' && (
                <section className="ms-guide-sec" aria-labelledby="g-cbx">
                    <h2 id="g-cbx">{GUIDE.cbxTitle[lang]}</h2>
                    <p>{GUIDE.cbx[lang]} <a href={OFFICIAL_LINKS.cbx} target="_blank" rel="noopener noreferrer">{GUIDE.cbxLink[lang]}</a></p>
                </section>
            )}

            <section className="ms-guide-sec" aria-labelledby="g-next">
                <h2 id="g-next">{GUIDE.nextTitle[lang]}</h2>
                <ul className="ms-guide-links">
                    <li><Link to={`/hotels?region=${region}`}>{GUIDE.hotelsMx(city)[lang]}</Link></li>
                    <li><Link to={`/hotels?region=${region}&side=us`}>{GUIDE.hotelsUs(usCity)[lang]}</Link></li>
                    <li><Link to={`/?region=${region}`}>{GUIDE.doctors(city)[lang]}</Link></li>
                    {other.map((r) => <li key={r}><Link to={`/getting-here?region=${r}`}>{GUIDE.title(REGIONS[r].mx.city)[lang]}</Link></li>)}
                </ul>
                <p className="ms-guide-note">{GUIDE.disclaimer[lang]}</p>
            </section>
        </main>
    );
}
