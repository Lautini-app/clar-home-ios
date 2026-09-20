// trial-ending-reminder — Mitteilung an die Testenden, dass ihr Zugang endet.
//
// Gedacht für den 25. Oktober 2026, sechs Tage vor dem Ende der Aktion
// «clar kostenlos bis 31. Oktober».
//
// WAS SIE TUT
//   Sucht alle Konten mit subscription_plan = 'trial' und noch aktivem Zugang,
//   verschickt je eine Mail über Resend und schreibt den Versand in
//   public.campaign_emails. Wer dort schon steht, bekommt nichts mehr — die
//   Funktion kann also gefahrlos mehrfach laufen.
//
// AUFRUF
//   POST mit Header  Authorization: Bearer <CAMPAIGN_CRON_TOKEN>
//   Body (alles freiwillig):
//     { "dry": true }              → verschickt NICHTS, listet nur die Empfänger
//     { "test": "du@example.com" } → verschickt genau eine Mail an diese Adresse
//
// NÖTIGE SECRETS (Supabase → Edge Functions → Secrets; trägt Rainer ein)
//   RESEND_API_KEY        Schlüssel von resend.com
//   MAIL_FROM             z. B.  clar by Lautini <hallo@lautini.ch>
//                         Die Absenderdomain muss in Resend verifiziert sein.
//   CAMPAIGN_CRON_TOKEN   frei gewähltes langes Geheimnis für den Aufruf
//   SERVICE_ROLE_KEY      (in Supabase meist schon vorhanden)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KIND = "trial-ending-2026-10";
const ENDE = "31. Oktober";

function mailHtml(): string {
  // Bewusst im Stil der bestehenden Bestätigungsmail gehalten:
  // schwarze Kopfzeile, ruhiger Text, ein Knopf.
  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden">
  <div style="background:#1a1a18;padding:28px 32px">
    <span style="color:#ffffff;font-size:18px;font-weight:500">clar · lautini</span>
  </div>
  <div style="padding:28px 32px">
    <p style="font-size:14px;color:#444441;line-height:1.7;margin:0 0 12px">Hallo,</p>

    <p style="font-size:14px;color:#444441;line-height:1.7;margin:0 0 20px">
      dein kostenloser Zugang zu clar läuft am <strong>${ENDE}</strong> aus. Danach
      sind die vier Apps wieder gesperrt.
    </p>

    <p style="font-size:14px;color:#444441;line-height:1.7;margin:0 0 20px">
      Es passiert nichts automatisch: Du bekommst keine Rechnung, und es gibt kein
      Abo, das gekündigt werden müsste. Deine Einträge bleiben in deinem Konto
      erhalten.
    </p>

    <p style="font-size:14px;color:#444441;line-height:1.7;margin:0 0 20px">
      Wenn du weitermachen möchtest, kannst du ein Abo wählen — eine App ab
      CHF 3.90 im Monat, alle vier für CHF 9.90, Familien-Sharing für fünf
      Personen inbegriffen.
    </p>

    <a href="https://home.lautini.ch" style="display:inline-block;background:#1a1a18;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:14px;font-weight:500">Zu meinen clar-Apps</a>

    <p style="font-size:14px;color:#444441;line-height:1.7;margin:24px 0 0">
      Und falls du magst: Mich interessiert sehr, was im Alltag wirklich geholfen
      hat — und was nicht. Eine Antwort auf diese Mail genügt.
    </p>

    <p style="font-size:14px;color:#444441;line-height:1.7;margin:20px 0 0">
      Herzlich<br>Rainer
    </p>
  </div>
  <div style="padding:16px 32px 24px;border-top:1px solid #f1efe8">
    <p style="font-size:12px;color:#a0a09b;line-height:1.6;margin:0">
      Du erhältst diese Nachricht, weil du ein clar-Konto hast — sie betrifft den
      Stand deines Zugangs.<br>clar · lautini.ch
    </p>
  </div>
</div>`.trim();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const antwort = (daten: unknown, status = 200) =>
    new Response(JSON.stringify(daten, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // ── Zugang prüfen ──
    const token = Deno.env.get("CAMPAIGN_CRON_TOKEN");
    const auth = req.headers.get("authorization") ?? "";
    if (!token || auth !== `Bearer ${token}`) {
      return antwort({ fehler: "Nicht berechtigt" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY =
      Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const RESEND_KEY = Deno.env.get("RESEND_API_KEY");
    const MAIL_FROM = Deno.env.get("MAIL_FROM");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { /* leerer Body ist erlaubt */ }
    const trockenlauf = body.dry === true;
    const einzeltest = typeof body.test === "string" ? body.test as string : null;

    // ── Einzeltest: eine Mail an eine frei gewählte Adresse ──
    if (einzeltest) {
      if (!RESEND_KEY || !MAIL_FROM) return antwort({ fehler: "RESEND_API_KEY oder MAIL_FROM fehlt" }, 500);
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: MAIL_FROM,
          to: [einzeltest],
          subject: `Dein clar-Zugang läuft am ${ENDE} aus`,
          html: mailHtml(),
        }),
      });
      const text = await r.text();
      return antwort({ modus: "Einzeltest", an: einzeltest, status: r.status, antwort: text.slice(0, 300) });
    }

    // ── Empfänger bestimmen ──
    const { data: zeilen, error } = await admin
      .from("subscribers")
      .select("user_id, email")
      .eq("subscription_plan", "trial")
      .eq("subscribed", true);
    if (error) return antwort({ fehler: error.message }, 500);

    // Pro Person nur einmal, auch wenn vier Zeilen existieren
    const proPerson = new Map<string, string>();
    for (const z of zeilen ?? []) {
      const r = z as { user_id: string | null; email: string | null };
      if (r.user_id && r.email) proPerson.set(r.user_id, r.email);
    }

    // Wer wurde schon benachrichtigt?
    const { data: bereits } = await admin
      .from("campaign_emails")
      .select("user_id")
      .eq("kind", KIND);
    const schonVerschickt = new Set((bereits ?? []).map((b: { user_id: string }) => b.user_id));

    const offen = [...proPerson.entries()].filter(([id]) => !schonVerschickt.has(id));

    if (trockenlauf) {
      return antwort({
        modus: "Trockenlauf — es wurde nichts verschickt",
        testkonten_gesamt: proPerson.size,
        bereits_benachrichtigt: schonVerschickt.size,
        wuerden_jetzt_mail_bekommen: offen.length,
        empfaenger: offen.map(([, mail]) => mail),
      });
    }

    if (!RESEND_KEY || !MAIL_FROM) return antwort({ fehler: "RESEND_API_KEY oder MAIL_FROM fehlt" }, 500);

    // ── Verschicken ──
    let verschickt = 0;
    const fehler: string[] = [];
    for (const [userId, mail] of offen) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: MAIL_FROM,
            to: [mail],
            subject: `Dein clar-Zugang läuft am ${ENDE} aus`,
            html: mailHtml(),
          }),
        });
        if (!r.ok) {
          fehler.push(`${mail}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
          continue;
        }
        await admin.from("campaign_emails").insert({ user_id: userId, email: mail, kind: KIND });
        verschickt++;
        // Resend erlaubt im Standardtarif rund 2 Mails pro Sekunde
        await new Promise((f) => setTimeout(f, 600));
      } catch (e) {
        fehler.push(`${mail}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return antwort({
      modus: "Versand",
      verschickt,
      uebersprungen_weil_schon_benachrichtigt: schonVerschickt.size,
      fehler,
    });
  } catch (err) {
    console.error("[trial-ending-reminder]", err);
    return antwort({ fehler: err instanceof Error ? err.message : "Unbekannter Fehler" }, 500);
  }
});
