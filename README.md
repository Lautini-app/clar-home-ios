# clar-home-ios

iOS-App-Hub für den Despia-Wrapper der clar·Apps.
Ziel-Domain: **app.lautini.ch** (Vercel, statisch).

Dies ist ein Fork von [clar-home-edit](../clar-home-edit/) mit den für iOS
notwendigen Anpassungen:

- Kein Stripe. Käufe laufen ausschliesslich über Apple IAP via RevenueCat
  (Apple-Guideline 3.1.1).
- iOS-Preise (siehe Tabelle unten).
- Kein Hinweis auf günstigere Kaufwege oder externe Web-Preise (Guideline 3.1.3).
- Safe-Area, kein Zoom, dunkler Statusbar-Ton passend zum clar-Grün, Push via
  Despia-Bridge nach Login, Offline-Banner.

Der bestehende Web-Hub unter `home.lautini.ch` (Repo `clar-home-edit`) bleibt
davon **unberührt**.

---

## Ordnerstruktur

```
clar-home-ios/
├── index.html                                     Der Hub (statisch)
├── manifest.json
├── icon-192.png · icon-512.png
├── vercel.json                                    Vercel-Config (Header)
├── README.md                                      Dieses Dokument
├── AUDIT.md                                       Nur-Lese-Audit der 4 Apps
└── supabase/
    ├── migrations/
    │   └── 20260707000000_apple_subscriptions.sql
    └── functions/
        └── revenuecat-webhook/
            ├── deno.json
            └── index.ts
```

---

## Produkt-IDs (App Store Connect · RevenueCat · index.html)

Diese IDs **müssen 1:1 identisch** in allen drei Systemen angelegt werden:

| Plan             | Monatlich                | Jährlich                 |
|------------------|--------------------------|--------------------------|
| 1 App            | `ch.lautini.clar.1app.monthly`      | `ch.lautini.clar.1app.yearly`       |
| 2 Apps           | `ch.lautini.clar.2apps.monthly`     | `ch.lautini.clar.2apps.yearly`      |
| Alle Apps        | `ch.lautini.clar.all.monthly`       | `ch.lautini.clar.all.yearly`        |

**iOS-Preise** (im UI hinterlegt in `index.html`, RevenueCat + App Store Connect):

| Plan       | Monatlich        | Jährlich       |
|------------|------------------|----------------|
| 1 App      | CHF 4.90 / Mt    | CHF 39 / Jahr  |
| 2 Apps     | CHF 8.90 / Mt    | CHF 59 / Jahr  |
| Alle Apps  | CHF 12.90 / Mt   | CHF 89 / Jahr  |

Der Code-Konstante lebt in [`index.html`](./index.html) unter `PRODUCT_IDS`
(gefroren via `Object.freeze`). Bei Preisänderungen: Preise in App Store
Connect + RevenueCat aktualisieren, `planPrices` in `index.html` anpassen.

**RevenueCat-Entitlements** (Aliasse, die der Client via
`apple_subscriptions.entitlement` interpretiert):

- `one`  ← alle `ch.lautini.clar.1app.*` Produkte
- `two`  ← alle `ch.lautini.clar.2apps.*` Produkte
- `all`  ← alle `ch.lautini.clar.all.*` Produkte

> Hinweis: Die Produkt-IDs `ch.lautini.clar.1app/2apps.monthly|yearly` existieren bereits
> in RevenueCat (Projekt clar.app) und App Store Connect (angelegt Mai 2026).
> Neu anzulegen sind nur `ch.lautini.clar.all.monthly` und `ch.lautini.clar.all.yearly`.
> Bestehende RevenueCat-Entitlements: `clar.app`, `markt`, `heim` — Mapping vor dem
> Launch mit diesem Schema abgleichen.

---

## Despia-Bridge

Die App nutzt diese URL-Schemata:

- `revenuecat://purchase?external_id={SUPABASE_USER_UUID}&product={PRODUCT_ID}` — startet den nativen Kauf-Flow. `external_id` = Supabase `auth.users.id` (auch für Gäste).
- `revenuecat://login?external_id={UUID}` — nur wenn ein Gäste-Kauf an ein **schon bestehendes** Konto gehängt wird (Despia-Nähe zu RevenueCat `logIn()`).
- `itms-apps://apps.apple.com/account/subscriptions` — Apples native Abo-Verwaltung.
- `push://register?external_id={UUID}` — Push-Registrierung; wird bei Session-Restore ausgelöst.

Der Aufruf läuft über `window.despia(url)` (vom Wrapper injiziert) mit Fallback
auf `webkit.messageHandlers.despia.postMessage`. **Ausserhalb des Wrappers**
(Browser, Vercel-Preview) fällt der Bridge-Aufruf auf `console.info('[despia stub]', url)`
zurück — kein Fehler, kein Crash.

### Despia-URL-Regeln (siehe [AUDIT.md](./AUDIT.md#4-empfohlene-despia-url-regeln-zusammenfassung))

Vor dem Build im Despia-Dashboard konfigurieren:

1. `https://home.lautini.ch/*` → Rewrite auf `https://app.lautini.ch/*`
2. `https://*.stripe.com/*` → Block/Redirect auf `https://app.lautini.ch/#abo`
3. `https://clar.markt.lautini.ch/pricing`, `https://clar.heim.lautini.ch/pricing`
   → Block/Redirect auf `https://app.lautini.ch/#abo`

Damit landen alte In-App-Links (Footer, "Abo verwalten"-Buttons in den
Apps) nicht mehr auf Stripe/Web-Preisen.

---

## Freischalt-Logik

Zugriff auf eine App ist frei, wenn **eine** dieser Quellen aktiv ist:

- `apple_subscriptions` (Apple-IAP)
- `groups`/`group_members` (Familien-Sharing in clar)

Die iOS-App liest **keine** Stripe-Tabelle `subscribers` und sperrt den
Apple-Kauf nicht wegen eines Web-Abos. Stripe bleibt auf dem Web-Weg
(clar-adhs.ch / home.lautini.ch).

Paywall:
- Aktives Apple-Abo → öffnet `itms-apps://…subscriptions`
- Sonst → Kauf über RevenueCat, mit stillem Gäste-Konto falls noch keines da ist

App-Auswahl bei 1/2-App-Abos: der Client speichert die Auswahl vor dem
Kauf in `apple_subscription_intents` (auch für Gäste); der Webhook
übernimmt sie nach `apple_subscriptions.selected_apps`.

---

## Gäste-Kauf

Ohne Formular legt die Hülle ein anonymes Supabase-Konto an. Damit wird
gekauft. Nach dem Kauf kann optional ein Konto angelegt werden — die
Personen-Nummer bleibt. Wer sich stattdessen in ein schon bestehendes
Konto einloggt, hängt das Abo per `claim-apple-subscription` und
`revenuecat://login` um.

**Dashboard (Rainer, falls noch nicht gesetzt):**

1. Authentication → Providers → **Anonymous** einschalten (im Test war es bereits an)
2. Authentication → Settings → **Manual linking** einschalten (für Apple-Umwandlung)
3. Functions deployen:

```bash
supabase functions deploy revenuecat-webhook --no-verify-jwt
supabase functions deploy claim-apple-subscription
```

---

## Backend-Setup (Supabase — additiv)

Alles unter `supabase/` ist neu. Es wird **nichts Bestehendes verändert**
(`subscribers`, `groups`, `group_members` bleiben unangetastet).

### 1. Migration einspielen

```bash
# Im Supabase-Projekt cgwpzpnklxphqxlixtva:
supabase db push
# ODER manuell im SQL-Editor:
supabase/migrations/20260707000000_apple_subscriptions.sql
```

Ergebnis:
- `public.apple_subscriptions` (RLS: user liest eigene, service_role schreibt)
- `public.apple_subscription_intents` (RLS: user verwaltet eigene)

### 2. Edge-Function deployen

```bash
supabase functions deploy revenuecat-webhook --no-verify-jwt
# --no-verify-jwt: RevenueCat schickt keinen Supabase-JWT.
# Die Auth läuft über X-Auth-Bearer im Wert von REVENUECAT_WEBHOOK_TOKEN.

supabase secrets set REVENUECAT_WEBHOOK_TOKEN=<sicherer-langer-token>
```

### 3. RevenueCat konfigurieren

- Dashboard → Project settings → Integrations → Webhooks:
  - URL: `https://<PROJECT>.functions.supabase.co/revenuecat-webhook`
  - Authorization header: `Bearer <REVENUECAT_WEBHOOK_TOKEN>`
- Products anlegen: die 6 IDs aus der Tabelle oben (mit iOS-Preisen).
- Entitlements: `one`, `two`, `all` — je die passenden Produkte zuordnen.
- Testen: RevenueCat → Webhooks → "Send test event" → sollte 200 zurückgeben.

---

## Vercel-Deployment

1. Vercel-Projekt neu anlegen (aus dem `Lautini-app/clar-home-ios`-Repo).
2. **Build & Development Settings:** keine — es ist statisches HTML.
   `Output Directory`: leer lassen (Root wird direkt serviert).
3. Custom-Domain `app.lautini.ch` verknüpfen und den DNS-CNAME in Cloudflare setzen.
4. Deploy testen: `https://app.lautini.ch` sollte den Hub zeigen, die Bridge-
   Aufrufe erscheinen als `[despia stub]` in der Browser-Konsole.

---

## Test-Plan — TestFlight Sandbox

Voraussetzungen:
- App via Despia gewrappt, TestFlight-Build eingereicht, Sandbox-Tester in
  App Store Connect angelegt.
- Sandbox-Gerät (iOS Settings → App Store → Sandbox Account → Sandbox-Tester
  einloggen).
- Migration eingespielt, Webhook produktiv, RevenueCat mit Sandbox-Modus.

### Basis-Sanity

- [ ] App öffnet, Splash → Kacheln (kein Login-Zwang). Stilles Gäste-Konto in der Session.
- [ ] Kein E-Mail-Fenster, solange das Konto keine Adresse hat.
- [ ] Kacheln erscheinen als "gesperrt" (Schloss). Keine Web-Preise, kein Stripe, kein Hinweis auf die Website.
- [ ] «Konto anlegen» ist optional und führt nicht in eine Sackgasse («Weiter ohne Konto»).

### Kauf-Flow (1-App-Abo, monatlich, ohne Konto)

- [ ] Paywall öffnen → Monatlich wählen → "1 App" → z. B. `markt` anhaken → "Abonnieren". Kein Login dazwischen.
- [ ] Native App-Store-Sheet erscheint mit `ch.lautini.clar2.1app.monthly`.
- [ ] Nach Kauf: gewählte Kachel geht auf. Optional-Hinweis «Konto anlegen, damit du das Abo auf allen Geräten nutzen kannst.» — schliessbar.
- [ ] Supabase: `apple_subscriptions` an der Gäste-UUID, `selected_apps` enthält die Wahl. `apple_subscription_intents` danach leer.

### Sonderfälle

- [ ] Stripe/Web-Abo hat in der iOS-App keine Wirkung (wird nicht gelesen, Kauf bleibt möglich).
- [ ] "Abo verwalten" (Apple-Abo aktiv) → öffnet native App-Store-Verwaltung via `itms-apps://…`.
- [ ] "All"-Plan Kauf → `entitlement=all`. Alle Kacheln entsperrt.
- [ ] Gäste-Konto per Apple oder E-Mail umwandeln → dieselbe `user_id`.
- [ ] Anmelden mit schon bestehendem Konto nach Gäste-Kauf → Abo wandert (claim + RevenueCat-Alias).

### Verlängerung / Ablauf (Sandbox: 1 Mt ≈ 5 min)

- [ ] Nach ~5 min: RENEWAL kommt → Row bleibt `active`, `expires_at` verschiebt sich.
- [ ] Nach Ablauf: EXPIRATION → `status=expired`. Kachel wird gesperrt.

### Offline / Rand

- [ ] Airplane-Mode an: roter Banner erscheint, Kacheln bleiben interaktiv (öffnen die iframe-App), Login-Versuch zeigt sanften Netzwerkfehler statt Crash.
- [ ] Session-Restore aus lokalem Storage funktioniert nach App-Neustart offline (Kacheln zeigen letzten bekannten Status).

---

## Verifikation: bestehende Repos unverändert

Vor dem ersten Commit gepr&uuml;ft — alle acht bestehenden Repos unter
`/Users/rainerboehm/Developer/Lautini/`:

- clar-home-edit — clean (nur der Fork wurde kopiert; Quelle bleibt unber&uuml;hrt)
- clar-markt · clar-heim · clar-tag · clar-log · clar-landing · blog · clar-web

Siehe [AUDIT.md](./AUDIT.md#5-was-nicht-gemacht-wurde).
