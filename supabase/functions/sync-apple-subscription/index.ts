// sync-apple-subscription — holt den aktuellen Abo-Stand eines Kontos direkt
// bei RevenueCat und schreibt ihn in public.apple_subscriptions.
//
// Wozu: Käufe ausserhalb des Kauf-Knopfs der App (Angebotscode im App Store,
// Abo-Seite im App Store, neues Gerät) landen bei RevenueCat zuerst unter
// einer anonymen ID ($RCAnonymousID:…). Der Webhook kann sie keinem Konto
// zuordnen. Die App ruft beim «Käufe wiederherstellen» zuerst
// revenuecat://login?external_id=<UUID> auf (RevenueCat hängt die anonyme ID
// an die UUID) und danach diese Funktion.
//
// Aufruf: POST, Authorization: Bearer <JWT des Kontos (auch Gäste-Konto)>
// Secrets: REVENUECAT_API_KEY (RevenueCat → Project settings → API keys;
//          der öffentliche iOS-Key appl_… reicht für GET /v1/subscribers)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function entitlementFromProduct(productId: string): "one" | "two" | "all" | null {
  if (!productId) return null;
  const p = productId.toLowerCase();
  if (p.includes("_all_") || p.includes(".all.")) return "all";
  if (p.includes("_2apps_") || p.includes("_2app_") || p.includes(".2apps.")) return "two";
  if (p.includes("_1app_") || p.includes(".1app.")) return "one";
  return null;
}

type RcSubscription = {
  expires_date?: string | null;
  purchase_date?: string | null;
  original_purchase_date?: string | null;
  period_type?: string | null;
  is_sandbox?: boolean;
  unsubscribe_detected_at?: string | null;
  store?: string;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const RC_KEY = Deno.env.get("REVENUECAT_API_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !RC_KEY) return json(500, { error: "server misconfigured" });

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) return json(401, { error: "Unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: "Unauthorized" });
  const userId = userData.user.id;

  const rcRes = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${RC_KEY}`, "Content-Type": "application/json" },
  });
  if (!rcRes.ok) {
    const text = await rcRes.text().catch(() => "");
    console.error("[sync-apple] revenuecat", rcRes.status, text.slice(0, 300));
    return json(502, { error: "revenuecat unavailable" });
  }
  const rc = await rcRes.json();
  const subs: Record<string, RcSubscription> = rc?.subscriber?.subscriptions ?? {};

  const now = Date.now();
  const synced: string[] = [];
  for (const [productId, sub] of Object.entries(subs)) {
    if (sub.store && sub.store !== "app_store") continue;
    const entitlement = entitlementFromProduct(productId);
    if (!entitlement) continue;
    const expiresMs = sub.expires_date ? Date.parse(sub.expires_date) : NaN;
    if (!Number.isNaN(expiresMs) && expiresMs <= now) continue;

    // Bei 1-/2-App-Abos die App-Auswahl nie mit [] überschreiben.
    let selectedApps: string[] = [];
    if (entitlement !== "all") {
      const { data: existing } = await admin
        .from("apple_subscriptions")
        .select("selected_apps")
        .eq("user_id", userId)
        .eq("entitlement", entitlement)
        .maybeSingle();
      if (Array.isArray(existing?.selected_apps) && existing.selected_apps.length) {
        selectedApps = existing.selected_apps;
      } else {
        const { data: intent } = await admin
          .from("apple_subscription_intents")
          .select("selected_apps")
          .eq("user_id", userId)
          .maybeSingle();
        if (Array.isArray(intent?.selected_apps)) selectedApps = intent.selected_apps;
      }
    }

    const periodType = String(sub.period_type || "").toLowerCase();
    const { error: upErr } = await admin.from("apple_subscriptions").upsert({
      user_id: userId,
      revenuecat_app_user_id: userId,
      product_id: productId,
      entitlement,
      selected_apps: selectedApps,
      status: "active",
      environment: sub.is_sandbox ? "sandbox" : "production",
      original_purchase_at: sub.original_purchase_date ?? null,
      purchased_at: sub.purchase_date ?? null,
      expires_at: sub.expires_date ?? null,
      cancelled_at: sub.unsubscribe_detected_at ?? null,
      is_trial: periodType === "trial" || periodType === "intro",
      raw_event: { source: "sync-apple-subscription", product_id: productId, subscription: sub },
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,entitlement" });
    if (upErr) {
      console.error("[sync-apple] upsert", upErr.message);
      return json(500, { error: upErr.message });
    }
    synced.push(productId);
  }

  return json(200, { ok: true, synced });
});
