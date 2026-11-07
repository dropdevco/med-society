# COEPRIS Baja California (REPSSABI)

Status: built 6 Nov 2026 · Owner: Emilio · Adapter: `scripts/sources/adapters/coepris-bc.ts`

REPSSABI is the state health regulator's register of establishments (Registro Estatal de Establecimientos de Servicios de Salud y Bienestar). Being on it is the strongest thing we can show for a recovery center: there is no dedicated post-operative certification in Tijuana. A listed center gets a **facility** badge with an expiry date.

## Access

Open. robots.txt allows everything, and the register page is public. Logo use authorized, recorded 6 Nov 2026 (see [Logo use](README.md#logo-use)).

## How it is read

- `repssabi_padron.php` draws its table from `api_coepris.php?tipo=todos`, a JSON feed (`{ mensaje, datos: [...] }`). On 6 Nov 2026 it held 276 records, all `ACTIVO`.
- The adapter keeps **class 623111** (nursing residences, which the regulator also labels "centros de recuperación") in **Tijuana, Rosarito and Tecate** with status `ACTIVO`: 8 records, all in Tijuana. The class also holds elder care, such as Alice Assisted Living.
- Phone numbers are in the feed and are **not collected**.
- A green run needs at least one record, and a drop of more than 30% turns it red.

## Fields

| Field | JSON | Notes |
|---|---|---|
| External ID | `NumRegistro` | The match key for facilities ([ADR 0008](../adr/0008-facility-badges.md)) |
| Name, address | `RazonSocial`, `Direccion` | |
| Issued, expires | `Emision`, `Vigencia` | `dd/mm/yyyy`, stored as dates. A badge ends when `Vigencia` passes |

## Links

- **COEPRIS's QR link (`QrInfo`) does not work:** all 4 tried on 6 Nov 2026 answered "ocurrio un error al consultar la base de datos".
- A badge links to the center's page on the [Padrón](padron-salud-bc.md) when it has one, because that page shows the number and expiry independently.
- Otherwise it links to `repssabi_validacion.php`, the page COEPRIS's own table links to. **That page shows what its link carries** (with no parameters it is blank), so it is a display, not a check. The data behind it comes from the feed.

## Run it

```bash
npm run sources -- --source=coepris-bc
```

Run the Padrón first so the links point at it: this adapter reads the Padrón's last good run.
