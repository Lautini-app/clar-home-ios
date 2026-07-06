// RevenueCat → Supabase Webhook
// ============================================================================
// Empfängt Server-Events von RevenueCat und pflegt die Tabelle
// public.apple_subscriptions. Wird als Supabase Edge Function deployed
// (Deno-Runtime).
//
// Sicherheit:
//  • Header `Authorization: Bearer <RC_WEBHOOK_TOKEN>` muss gesetzt sein.
//    Wert stimmt mit Env-Var REVENUECAT_WEBHOOK_TOKEN überein.
//  • Nur die Service-Role schreibt in apple_subscriptions.
//
// Konvention:
//  • `app_user_id` in RevenueCat = Supabase auth.users.id (UUID).
//    (In der App via revenuecat://purchase?external_id={UUID} gesetzt.)
//  • `product_id` folgt der Konvention clar_{1app|2apps|all}_{monthly|yearly}.
//    Daraus wird das "Entitlement" (one|two|all) abgeleitet.
//
// Env-Vars (Supabase Dashboard → Edge Functions → Secrets):
//   REVENUECAT_WEBHOOK_TOKEN   – geteilter Token, im RC-Dashboard hinterlegt
//   SUPABASE_URL               – automatisch injiziert
//   SUPABASE_SERVICE_ROLE_KEY  – automatisch injiziert
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type RevenueCatEventType =
  | "INITIAL_PURCHASE"
  | "RENEWAL"
  | "PRODUCT_CHANGE"
  | "CANCELLATION"
  | "UNCANCELLATION"
  | "NON_RENEWING_PURCHASE"
  | "SUBSCRIPTION_PAUSED"
  | "EXPIRATION"
  | "BILLING_ISSUE"
  | "TRANSFER"
  | "SUBSCRIBER_ALIAS"
  | "TEST";

type RevenueCatEvent = {
  event: {
    type: RevenueCatEventType;
    app_user_id: string;
    original_app_user_id?: string;
    product_id: string;
    period_type?: "NORMAL" | "INTRO" | "TRIAL" | "PROMOTIONAL";
    purchased_at_ms?: number;
    expiration_at_ms?: number;
    original_purchase_at_ms?: number;
    environment?: "SANDBOX" | "PRODUCTION";
    entitlement_id?: string;
    entitlement_ids?: string[];
    cancel_reason?: string;
    [key: string]: unknown;
  };
  api_version?: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RC_WEBHOOK_TOKEN = Deno.env.get("REVENUECAT_WEBHOOK_TOKEN") ?? "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function entitlementFromProduct(productId: string): "one" | "two" | "all" | null {
  if (!productId) return null;
  const p = productId.toLowerCase();
  if (p.includes("_all_")) return "all";
  if (p.includes("_2apps_") || p.includes("_2app_")) return "two";
  if (p.includes("_1app_"))  return "one";
  return null;
}

function isoOrNull(ms?: number): string | null {
  if (!ms || Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function verifyAuth(req: Request): boolean {
  if (!RC_WEBHOOK_TOKEN) return false; // Fail closed wenn nicht konfiguriert
  const header = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!header) return false;
  const [, token] = header.split(" ");
  return token === RC_WEBHOOK_TOKEN;
}

async function readIntent(userId: string) {
  const { data } = await supabase
    .from("apple_subscription_intents")
    .select("product_id, selected_apps, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  return data ?? null;
}

async function handleEvent(evt: RevenueCatEvent["event"]) {
  const userId = evt.app_user_id;
  if (!userId) throw new Error("missing app_user_id");

  const entitlement = entitlementFromProduct(evt.product_id);
  if (!entitlement) {
    console.warn("[rc-webhook] unknown product_id, ignoring", evt.product_id);
    return { ok: true, ignored: true };
  }

  // Für Cancel-/Expire-Events: Status setzen, expires_at stehen lassen.
  if (evt.type === "CANCELLATION" || evt.type === "EXPIRATION" || evt.type === "SUBSCRIPTION_PAUSED") {
    const status =
      evt.type === "EXPIRATION"          ? "expired" :
      evt.type === "SUBSCRIPTION_PAUSED" ? "paused"  :
                                           "cancelled";
    const { error } = await supabase
      .from("apple_subscriptions")
      .update({
        status,
        cancelled_at: new Date().toISOString(),
        raw_event: evt as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId)
      .eq("entitlement", entitlement);
    if (error) throw error;
    return { ok: true, status };
  }

  // Aktivierendes Event (INITIAL_PURCHASE / RENEWAL / UNCANCELLATION / PRODUCT_CHANGE)
  const intent = ["INITIAL_PURCHASE", "PRODUCT_CHANGE"].includes(evt.type)
    ? await readIntent(userId)
    : null;

  const selectedApps =
    entitlement === "all"
      ? []
      : intent?.selected_apps && Array.isArray(intent.selected_apps)
        ? intent.selected_apps
        : [];

  const row = {
    user_id: userId,
    revenuecat_app_user_id: userId,
    product_id: evt.product_id,
    entitlement,
    selected_apps: selectedApps,
    status: "active",
    environment: evt.environment ? evt.environment.toLowerCase() : null,
    original_purchase_at: isoOrNull(evt.original_purchase_at_ms),
    purchased_at:         isoOrNull(evt.purchased_at_ms),
    expires_at:           isoOrNull(evt.expiration_at_ms),
    cancelled_at:         null,
    is_trial:             evt.period_type === "TRIAL" || evt.period_type === "INTRO",
    raw_event:            evt as unknown as Record<string, unknown>,
    updated_at:           new Date().toISOString(),
  };

  const { error } = await supabase
    .from("apple_subscriptions")
    .upsert(row, { onConflict: "user_id,entitlement" });
  if (error) throw error;

  // Intent aufräumen, sobald der Kauf verbucht ist.
  if (intent) {
    await supabase
      .from("apple_subscription_intents")
      .delete()
      .eq("user_id", userId);
  }

  return { ok: true, entitlement, status: "active" };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "method not allowed" });
  }

  if (!verifyAuth(req)) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  let payload: RevenueCatEvent;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse(400, { error: "invalid json" });
  }

  const evt = payload?.event;
  if (!evt || !evt.type) {
    return jsonResponse(400, { error: "missing event" });
  }

  // Test-Events akzeptieren aber nichts persistieren.
  if (evt.type === "TEST") {
    return jsonResponse(200, { ok: true, kind: "test" });
  }

  try {
    const result = await handleEvent(evt);
    return jsonResponse(200, result);
  } catch (err) {
    console.error("[rc-webhook] failed", err);
    return jsonResponse(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
