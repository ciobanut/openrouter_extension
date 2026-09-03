# OpenRouter Analytics API — note de cercetare (reverse-engineered)

Descoperite pe 2026-09-03 prin interceptarea requesturilor dashboardului
(https://openrouter.ai/activity) cu un wrapper peste `window.fetch`.
Contractul NU este documentat oficial — verifică din nou dacă OpenRouter
publică documentație pentru aceste endpoint-uri private.

## Endpoint

```
POST https://openrouter.ai/api/frontend/v1/private/analytics-query
Cookie: sesiunea openrouter.ai (fără API key — folosește fetch cu credentials)
Content-Type: application/json
```

Extensia îl apelează prin service worker (`background.js` → `fetchFrontend`)
pentru că popup-ul nu are acces la cookie-urile openrouter.ai.

## Payload (câmpuri observate)

```jsonc
{
  "metrics": [...],          // vezi lista mai jos
  "dimensions": ["model"],   // "model" | "api_key_id" | "app"; MAX 2 per query
  "granularity": "minute" | "hour" | "day",  // opțional
  "time_range": { "start": "<ISO UTC>", "end": "<ISO UTC>" },
  "order_by": { "field": "date", "direction": "asc" },
  "limit": 400,              // dashboardul folosește 400 pentru seriile de timp
  "topN": 5,                 // folosit de graficele dashboardului (per model)
  "timezone": "Europe/Chisinau",  // IANA! DOAR pentru granularity "day" — aliniază și TAIE bucket-urile la fusul dat
  "includeEnrichment": true  // prezent la query-urile pe api_key_id/app
}
```

### Metrici disponibile

- `total_usage` — costul total ($)
- `request_count`
- `tokens_total`, `tokens_prompt`, `tokens_completion`
- `reasoning_tokens`, `cached_tokens`
- `cache_hit_rate` — 0..1 fracție SAU 0..100 procent (codul normalizează ambele)
- `byok_usage`, `byok_request_count` (BYOK = bring your own key)
- componente de spend (din cookbook-ul oficial): `usage_upstream`, `usage_cache`, `usage_data`, `usage_web`, `usage_file`

Răspuns: rânduri cu fie câmpuri plate (`total_usage`, `model`, `date`...), fie
nested (`metrics.total_usage`, `dimensions.model`). Codul din popup acceptă
ambele forme: `const m = entry.metrics || entry`.

## ⚠️ Capcana principală (ne-a costat cel mai mult)

**Fără `timezone`, bucket-urile de zi NU sunt tăiate la limitele
`time_range`.** API-ul întoarce zile UTC ÎNTREGI pentru orice zi care se
suprapune cu intervalul. Ex: interval [Sep 2 21:00Z (miezul nopții GMT+3),
acum] → primești bucket-ul complet Sep 2 + Sep 3 → total umflat.

Soluția dashboardului (și a noastră):
- **intervale sub-o zi** (Today): `granularity: "hour"` pe [limita locală, acum]
- **week/month**: `granularity: "day"` + `timezone: "<IANA>"` — API-ul aliniază
  zilele la fusul trimis și le taie corect

## Cum calculează dashboardul intervalele (capturat 2026-09-03)

Dashboardul își ține fusul în `localStorage["activity-display-timezone"]`;
valoarea default este `"local"` = fusul browserului
(`Intl.DateTimeFormat().resolvedOptions().timeZone`).

| Preset | Interval | Granularity | timezone |
|---|---|---|---|
| 15 min | `[now-15m, now]` (rulant) | minute | — |
| 1 hour | `[now-1h, now]` | minute | — |
| 3 hours | `[now-3h, now]` | minute | — |
| Today | `[miezul nopții locale, now]` | hour | — |
| This Week | `[luni 00:00 local, now]` | day | ✅ IANA |
| This Month | `[1-ul lunii 00:00 local, now]` | day | ✅ IANA |

- Săptămâna OpenRouter începe **luni** (confirmat: URL `from=2026-08-30T21:00Z`
  = luni 00:00 GMT+3).
- Pentru indicatorii „vs prev period" dashboardul mai trimite o a doua query
  pe intervalul precedent (nu ne trebuie momentan).

## Capcane JS/Chrome (pentru extensie)

- `chrome.runtime.sendMessage` serializează JSON: trimite Date ca string ISO
  (`start.toISOString()`), nu ca obiect Date.
- Fallback-ul din background `msg.minutes || 60` se aplică doar când NU se
  trimite `start` — prioritate: `start` > `minutes` (bug istoric: căzuse
  `minutes` din mesaj și 15 MIN / 3 HOURS arătau amândouă ultima oră).
- `granularity: "day"` + fus cu offset ntreg (ex. GMT+3): miezul nopții locale
  cade pe margine de oră UTC, dar pentru fusuri de tip +5:30 primul bucket de
  zi ar putea include minute în plus — n-a fost testat.

## Legătura cu dashboardul (numere de referință, 2026-09-03, GMT+3)

| Perioadă | Dashboard | Popup înainte de fix | Cauza diferenței |
|---|---|---|---|
| Today | $0.17 | $1.74 | bucket UTC Sep 2 întreg inclus |
| This Week | $4.87 | $7.42 | fereastră rulantă 7 zile + zile UTC întregi |
| This Month | $3.84 | $15.92 → $4.83 | fereastră rulantă 30 zile + zile UTC întregi |
