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
| 1 App            | `clar_1app_monthly`      | `clar_1app_yearly`       |
| 2 Apps           | `clar_2apps_monthly`     | `clar_2apps_yearly`      |
| Alle Apps        | `clar_all_monthly`       | `clar_all_yearly`        |

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

- `one`  ← alle `clar_1app_*` Produkte
- `two`  ← alle `clar_2apps_*` Produkte
- `all`  ← alle `clar_all_*` Produkte

---

## Despia-Bridge

Die App nutzt drei URL-Schemata:

- `revenuecat://purchase?external_id={SUPABASE_USER_UUID}&product={PRODUCT_ID}` — startet den nativen Kauf-Flow. `external_id` = Supabase `auth.users.id`. (Alternative des Wrappers: `revenuecat://launchPaywall?offering=default`.)
- `itms-apps://apps.apple.com/account/subscriptions` — Apples native Abo-Verwaltung.
- `push://register?external_id={UUID}` — Push-Registrierung; wird bei Login und Session-Restore ausgelöst.

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

- `subscribers` (Stripe/Web — Legacy, bestehende Kunden)
- `groups`/`group_members` (Familien-Sharing — bestehend, unverändert)
- `apple_subscriptions` (Apple-IAP — **neu**, additiv)

Priorisierung in der Paywall:
- Aktives Web-Abo → Paywall zeigt Hinweis "Abo aktiv, über Web-Konto"; Kauf-Button ist deaktiviert. Kein Stripe-Link.
- Aktives Apple-Abo → Paywall öffnet direkt `itms-apps://…subscriptions`; Verwalten geht über App Store.
- Kein Abo → normale Paywall mit RevenueCat-Kauf.

App-Auswahl bei 1/2-App-Abos: der Client speichert die Auswahl vor dem
Kauf in `apple_subscription_intents`; der Webhook übernimmt sie beim
INITIAL_PURCHASE nach `apple_subscriptions.selected_apps`.

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

- [ ] App öffnet, Splash → Login-Screen.
- [ ] Registrierung neuer Sandbox-User → Session steht.
- [ ] E-Mail-Consent-Modal erscheint einmalig; Auswahl wird in `email_consent` persistiert.
- [ ] Push-Registrierung: `[despia] push://register?external_id=<uuid>` sichtbar in Wrapper-Logs.
- [ ] Kacheln erscheinen als "gesperrt" (Schloss) — keine Web-Preise sichtbar.

### Kauf-Flow (1-App-Abo, monatlich)

- [ ] Paywall öffnen → Monatlich wählen → "1 App" → z. B. `markt` anhaken → "Abonnieren".
- [ ] Native App-Store-Sheet erscheint mit `clar_1app_monthly` und Sandbox-Hinweis "[Sandbox]".
- [ ] Kauf mit Sandbox-Test-Konto bestätigen.
- [ ] Nach Kauf: der Client pollt bis zu 20 s auf Webhook-Bestätigung; danach zeigt der Hub die App entsperrt.
- [ ] Supabase: `apple_subscriptions` enthält eine Zeile mit `entitlement=one`, `selected_apps=['markt']`, `status=active`, `environment=sandbox`, `expires_at ~5 min` (Sandbox-Beschleunigung).
- [ ] `apple_subscription_intents` ist wieder leer (der Webhook hat den Intent konsumiert).

### Verlängerung / Ablauf (Sandbox: 1 Mt ≈ 5 min)

- [ ] Nach ~5 min: RENEWAL kommt → Row bleibt `active`, `expires_at` verschiebt sich.
- [ ] Nach mehreren Renewals oder manuellem Kündigen im App-Store: CANCELLATION → `status=cancelled`, `cancelled_at` gesetzt. Zugriff bleibt bis `expires_at` bestehen.
- [ ] Nach Ablauf: EXPIRATION → `status=expired`. Kachel wird gesperrt.

### Sonderfälle

- [ ] Nutzer hat aktives Stripe-Web-Abo (`subscribers.subscribed=true`) → Paywall zeigt "Abo aktiv (Web-Konto)". Kauf-Button deaktiviert. Kein Stripe-Link sichtbar. Zugriff steht.
- [ ] "Abo verwalten" (Apple-Abo aktiv) → öffnet native App-Store-Verwaltung via `itms-apps://…`.
- [ ] "All"-Plan Kauf → `entitlement=all`, `selected_apps=[]`. Alle Kacheln sind entsperrt (inkl. `clar·log`? — nein: clar·log-Kachel bleibt "bald verfügbar" bis der Launch freigegeben ist; der Zugriff wird trotzdem gewährt sobald sie live geht).
- [ ] clar·log-Kachel: identisches Verhalten wie im Web ("bald verfügbar", Kachel gedimmt, kein Klick).
- [ ] App wird nach Kauf minimiert (App-Store-Kontenverwaltung) und zurückgeholt → `visibilitychange`-Handler lädt Abo-Status neu; UI aktualisiert sich.

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
