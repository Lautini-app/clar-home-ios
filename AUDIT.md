# AUDIT — hardkodierte Verweise in den vier clar-Apps

Nur-Lese-Bericht. Kein Repo wurde für dieses Audit verändert.

**Ziel:** Überblick, welche Stellen der vier gewrappten Apps innerhalb des
iOS-Wrappers durch Despia-URL-Regeln oder Router-Regeln umgeleitet werden
müssen. Die Apps selbst bleiben unangetastet (Web-Betrieb muss unverändert
weiterlaufen).

Stand: 2026-07-06 · Repos:
[clar-markt](../clar-markt/) ·
[clar-heim](../clar-heim/) ·
[clar-tag](../clar-tag/) ·
[clar-log](../clar-log/)

---

## 1. Verweise auf `home.lautini.ch`

Diese Links müssen im Wrapper auf `app.lautini.ch` (den iOS-Hub) umgeleitet
werden — damit ein Klick nicht Safari öffnet, sondern innerhalb der App bleibt.

| Datei | Zeile | Kontext |
|-------|-------|---------|
| clar-markt/src/routes/__root.tsx | 460 | `<a href="https://home.lautini.ch">…</a>` (Footer) |
| clar-markt/src/routes/__root.tsx | 136 | Kommentar (iframe-Detection) — nicht laufzeitrelevant |
| clar-heim/src/routes/__root.tsx | 300 | `<a href="https://home.lautini.ch">…</a>` (Footer) |
| clar-tag/src/routes/__root.tsx | 149 | `<a href="https://home.lautini.ch">…</a>` (Footer) |
| clar-log/src/components/clar/SettingsView.tsx | 1263 | `window.location.href = "https://home.lautini.ch"` (Nach-Kontolöschung-Redirect) |
| clar-log/src/routes/_authenticated.hilfe.tsx | 219 | Link auf `home.lautini.ch` im Preise-FAQ |
| clar-log/src/lib/embedded-shell.ts | 49 | Kommentar (iframe-Detection) — nicht laufzeitrelevant |
| clar-log/docs/hilfe-content.md | 61 | Content-Datei — nicht laufzeitrelevant |

**Despia-Regel (vorgeschlagen):** URL-Rewrite
`https://home.lautini.ch → https://app.lautini.ch` im Wrapper konfigurieren.

---

## 2. Verweise auf `billing.stripe.com` (Stripe Customer Portal)

Diese Buttons dürfen im Wrapper **nicht** die externe Stripe-Portal-URL
öffnen — Apple untersagt es, Nutzer/innen aus einer iOS-App direkt zur
Verwaltung eines nicht-IAP-Abos zu leiten. Innerhalb des Wrappers sollte
diese Aktion auf die `app.lautini.ch`-Verwaltung umgelenkt oder blockiert
werden.

| Datei | Zeile | Kontext |
|-------|-------|---------|
| clar-log/src/components/clar/SettingsView.tsx | 1216 | `const PORTAL_URL = "https://billing.stripe.com/p/login/8wM6r9edt7DsdZm288"` — direkt hardkodiert |
| clar-log/src/components/clar/SettingsView.tsx | 1253, 1287, 1298 | Drei "Abo verwalten ↗"-Buttons, alle mit `PORTAL_URL` |
| clar-markt/src/components/SettingsSheet.tsx | 557 | Button "Abo verwalten" → `openPortal()` (fetcht per Supabase-Function eine Stripe-Portal-Session, öffnet die URL im neuen Tab) |
| clar-markt/src/lib/stripe-coupons.functions.ts | 15 | Serverseitiger `api.stripe.com`-Call (nur Backend, kein UI-Redirect) |

clar-heim und clar-tag haben keine `Abo verwalten`-Buttons in den durchsuchten
UI-Dateien — Abos werden dort über die Web-Startseite verwaltet.

**Despia-Regel (vorgeschlagen):** URL-Blocklist für
`billing.stripe.com` und alle `*.stripe.com/session/…`-URLs; stattdessen
Redirect zu `app.lautini.ch/#abo` oder — bei aktivem Apple-Abo —
`itms-apps://apps.apple.com/account/subscriptions`.

---

## 3. Preisangaben und Web-Kauf-Hinweise

Web-Preise, die im Wrapper sichtbar wären, verstossen gegen Apple 3.1.3(b)
(kein Hinweis auf günstigere externe Kaufwege). Diese Stellen brauchen im
Wrapper eine Router-Regel (Redirect auf app.lautini.ch, wo die Apple-Preise
dominieren), oder die Seiten sind nur ausserhalb des Wrappers erreichbar.

**Volle `/pricing`-Routen (Landing/Marketing):**

| Datei | Preise sichtbar |
|-------|-----------------|
| clar-markt/src/routes/pricing.tsx (Zeile 136 f., 157 f.) | CHF 3.90/Mt · CHF 29/Jahr |
| clar-heim/src/routes/pricing.tsx (Zeile 25, 30, 165, 179) | CHF 3.90/Mt · CHF 29/Jahr |
| (clar-tag, clar-log: kein `/pricing`) | — |

**Weitere Preisstellen:**

| Datei | Zeile(n) | Preise / Inhalt |
|-------|----------|-----------------|
| clar-markt/src/lib/pricing-locale.ts | 22–25 | CHF 29/Jahr · CHF 3.90/Monat · CHF 2.42 (pro Monat bei Jahresabo) |
| clar-markt/src/routes/hilfe.tsx | 215 | Steuersätze |
| clar-markt/src/routes/help.tsx | 95, 98, 325 | Monats-/Jahresabo-Preise + Steuersätze |
| clar-markt/src/routes/agb.tsx | 54–55 | Preise in AGB |
| clar-markt/src/routes/wie-es-funktioniert.tsx | 75 | "Heute fällig: CHF 0" (Coupon-Kontext) |
| clar-markt/src/routes/pricing.tsx | 136, 157 | Preise auf Landing/Marketing-Seite |
| clar-markt/src/lib/email-templates/payment-failed.tsx | 59 | Preis in Mail-Template (nur Server, nicht UI) |
| clar-heim/src/routes/pricing.tsx | 25, 30, 165, 179 | Preise + Meta |
| clar-tag/konzepte_import/clar_task_Konzept.md | 118 | Preis in Konzept-Doku (nicht ausgeliefert) |
| clar-log | — | Keine Abo-Preise im UI. `2/Monat` in ReportView.tsx bezieht sich auf ein Wortbericht-Limit, nicht auf Preise. |

Auf einer `/pricing`-Seite bleiben Preisangaben zwangsläufig sichtbar. Für
den Wrapper werden diese Routen entweder komplett geblockt oder ins App-Hub
umgeleitet, sodass dort statt der Web-Preise die IAP-Paywall greift.

---

## 4. Empfohlene Despia-URL-Regeln (Zusammenfassung)

Konkret im Despia-Dashboard eintragen (in dieser Reihenfolge):

1. **Rewrite** `https?://home\.lautini\.ch/?.*` → `https://app.lautini.ch/$1`
2. **Block/Redirect** `https?://.*\.stripe\.com/.*` → `https://app.lautini.ch/#abo`
3. **Block/Redirect** `https?://clar\.markt\.lautini\.ch/pricing` → `https://app.lautini.ch/#abo`
4. **Block/Redirect** `https?://clar\.heim\.lautini\.ch/pricing`  → `https://app.lautini.ch/#abo`

Diese Regeln greifen ausschliesslich innerhalb des Wrappers. Der Web-Betrieb
(Safari, Vercel-Domains) läuft unverändert.

---

## 5. Was NICHT gemacht wurde

- Kein Quellcode der vier Apps wurde verändert.
- Keine Commits, keine Branches, keine PRs in den bestehenden Repos.
- `git status` aller acht bestehenden Repos ist zum Zeitpunkt dieses Audits
  identisch mit dem Zustand vor Beginn der Arbeit.
