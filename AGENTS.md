# clar — die Hülle (iOS und Web)

Eine einzelne `index.html` (statisch, kein Build): Startseite mit Kacheln für
die clar-Apps, Paywall, Konto, Abo-Verwaltung, Kontolöschung.
**Despia** verpackt app.lautini.ch als iOS-App — ein Push hierhin verändert die
App im Store sofort, ohne neuen Build.

**Domain:** app.lautini.ch · **Apple-ID:** 6773464586

## Apple App Review — aktueller Stand

**Version 1.1.0 (Build 8070432) ist ABGELEHNT**, Guideline **5.1.1(v)**:
Die App verlangte eine Registrierung, bevor ein Abo gekauft werden konnte.
`startPurchase()` brach ohne Session ab und schickte zum Login. Erklärtexte
(Commit `913ccbc`) haben nicht gereicht.

**Umbau (Branch, noch nicht auf main):** Stilles Gäste-Konto (Supabase anonym),
Kauf mit dieser Personen-Nummer als RevenueCat `external_id`, Konto danach
optional. Dieselbe Nummer bleibt beim Umwandeln. RevenueCat-Alias nur, wenn
jemand ein schon bestehendes Konto nimmt. iOS liest keine Stripe-Abos und
erwähnt die Website nicht.

Noch nicht an Apple übermittelt. «Erneut zur App-Prüfung übermitteln» bleibt
ausgegraut, bis an der nativen App-Version etwas geändert wird.

**Damit der Weg live geht, braucht es im Supabase-Dashboard (Rainer):**
1. Authentication → Providers → Anonymous sign-ins — im Test bereits an
2. Authentication → Settings → Manual linking einschalten (für Apple-Umwandlung)
3. Edge Functions: `revenuecat-webhook` neu deployen, `claim-apple-subscription` deployen

## Was man über frühere Runden wissen sollte

- Die alte Abo-Gruppe `clar.abos` hat ein von Apple nicht mehr unterstütztes
  Format und ist unbrauchbar. Aktuell ist **`clar.abos2`** mit den IDs
  `ch.lautini.clar2.*`.
- Erstmalige Abos müssen **zusammen mit einer App-Version und der
  Gruppen-Version** übermittelt werden, sonst
  `SUBSCRIPTION_SUBMISSION_REQUIRES_GROUP_VERSION`.
- Alle sechs Abos sind **nur in der Schweiz** verfügbar.
- **App Store Connect speichert Anhänge nicht im Entwurf.** Eine Antwort mit
  Video braucht die Datei beim Senden neu angehängt — das hat einmal acht Tage
  gekostet.
- Reviewer-Zugang: unten **fünfmal auf das clar-Logo tippen**, dann mit den
  hinterlegten Prüfer-Zugangsdaten anmelden.

## Das clar-Universum

clar ist eine Familie von Web-Apps für Familien mit ADHS, gebaut und betrieben
von einer Einzelperson (Rainer Böhm, Heilpädagoge, Schweiz).

| App | Zweck | Domain |
|---|---|---|
| clar (Hülle/iOS) | Kacheln, Paywall, Konto, Abos | app.lautini.ch |
| clar·log | Medikamenten- und Beobachtungstagebuch | clar.log.lautini.ch |
| clar·heim | Familien-Haushalt, Aufgaben | clar.heim.lautini.ch |
| clar·markt | Einkauf und Vorrat | clar.markt.lautini.ch |
| clar·tag | Tagesstruktur | clar.tag.lautini.ch |
| Landing | Produktseite de/fr/en | clar-adhs.ch |
| Blog | 25 Seiten | blog.lautini.ch |

**Hosting:** Vercel, git-verbunden — Push auf `main` deployt.
Die iOS-App ist eine Despia-Hülle um app.lautini.ch: **ein Web-Deploy verändert
die App sofort, ohne neuen Build im App Store.**

**Datenbank:** ein gemeinsames Supabase-Projekt, getrennt nach Schema
(`clar_log`, `clar_heim`, `clar_markt`, `clar_tag`), gemeinsames `public` für
kontoweite Dinge (`email_consent`, `audit_log`). Jeder Browser-Client setzt
`db: { schema: "…" }`.

**Abos:** RevenueCat, Produkt-IDs `ch.lautini.clar2.{1app|2apps|all}.{monthly|yearly}`.
Die Edge Function `revenuecat-webhook` leitet die Berechtigung per Textvergleich
aus der Produkt-ID ab (`.all.` / `.2apps.` / `.1app.`) — neue IDs müssen diesem
Muster folgen.

## Feste Vorgaben

- **Deutsch**, auch in Commit-Nachrichten und in der Oberfläche.
- **Schweiz-only** (revDSG). Abos sind nur in CHE verfügbar. Keine Ausweitung
  ohne ausdrückliche Rückfrage.
- **Gesundheitsdaten von Kindern.** Datensparsamkeit geht vor Bequemlichkeit.
  E-Mail-Erinnerungen wurden bewusst nicht gebaut, weil dafür Adressen von
  Angehörigen gespeichert werden müssten.
- **Nichts nach aussen senden** (App Store, E-Mail, Veröffentlichungen) ohne
  ausdrückliche Freigabe.
- **Keine Schlüssel im Klartext** — weder in Dateien noch in Remote-URLs.
- Der Autor ist Heilpädagoge, kein Informatiker: erkläre ohne Fachjargon,
  dafür konkret und an Beispielen.

## Regel, die teuer gelernt wurde

Jede Ansicht für **Nicht-Eingeloggte** (Arzt-Dossier, Beobachter-Formular,
Kalenderfeed) MUSS über eine Server-Function mit Service-Key laufen — niemals
direkt per supabase-js aus dem Browser. RLS gibt anonymen Besuchern nichts
zurück, und zwar **ohne Fehler**: die Seite bleibt einfach leer.
