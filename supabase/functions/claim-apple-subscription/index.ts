// claim-apple-subscription — zieht ein Apple-Abo vom Gäste-Konto auf ein
// schon bestehendes Konto um. Nur nötig, wenn jemand NICHT das Gäste-Konto
// umwandelt, sondern sich mit einem anderen Konto anmeldet.
//
// Aufruf: POST JSON { guest_access_token }
// Authorization: Bearer <JWT des Ziel-Kontos>
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: "server misconfigured" });

  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const callerJwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!callerJwt) return json(401, { error: "Unauthorized" });

  let payload: { guest_access_token?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  const guestJwt = String(payload.guest_access_token || "").trim();
  if (!guestJwt) return json(400, { error: "guest_access_token fehlt" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: callerData, error: callerErr } = await admin.auth.getUser(callerJwt);
  if (callerErr || !callerData?.user) return json(401, { error: "Unauthorized" });
  if (callerData.user.is_anonymous) return json(400, { error: "Ziel ist noch ein Gäste-Konto" });

  const { data: guestData, error: guestErr } = await admin.auth.getUser(guestJwt);
  if (guestErr || !guestData?.user) return json(400, { error: "Gäste-Sitzung ungültig" });
  if (!guestData.user.is_anonymous) return json(400, { error: "Quelle ist kein Gäste-Konto" });

  const fromId = guestData.user.id;
  const toId = callerData.user.id;
  if (fromId === toId) return json(200, { ok: true, same_user: true });

  const { data: rows, error: readErr } = await admin
    .from("apple_subscriptions")
    .select("product_id, entitlement, selected_apps, status, environment, original_purchase_at, purchased_at, expires_at, cancelled_at, is_trial")
    .eq("user_id", fromId);
  if (readErr) return json(500, { error: readErr.message });

  for (const row of rows || []) {
    const { error: upErr } = await admin.from("apple_subscriptions").upsert({
      user_id: toId,
      revenuecat_app_user_id: toId,
      product_id: row.product_id,
      entitlement: row.entitlement,
      selected_apps: row.selected_apps ?? [],
      status: row.status,
      environment: row.environment,
      original_purchase_at: row.original_purchase_at,
      purchased_at: row.purchased_at,
      expires_at: row.expires_at,
      cancelled_at: row.cancelled_at,
      is_trial: row.is_trial,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,entitlement" });
    if (upErr) return json(500, { error: upErr.message });
  }

  if ((rows || []).length) {
    const { error: delErr } = await admin.from("apple_subscriptions").delete().eq("user_id", fromId);
    if (delErr) return json(500, { error: delErr.message });
  }

  const { data: intent, error: intentReadErr } = await admin
    .from("apple_subscription_intents")
    .select("product_id, selected_apps, created_at")
    .eq("user_id", fromId)
    .maybeSingle();
  if (intentReadErr) return json(500, { error: intentReadErr.message });
  if (intent) {
    const { error: intentErr } = await admin.from("apple_subscription_intents").upsert({
      user_id: toId,
      product_id: intent.product_id,
      selected_apps: intent.selected_apps,
      created_at: intent.created_at,
    }, { onConflict: "user_id" });
    if (intentErr) return json(500, { error: intentErr.message });
    await admin.from("apple_subscription_intents").delete().eq("user_id", fromId);
  }

  return json(200, {
    ok: true,
    from: fromId,
    to: toId,
    moved: (rows || []).length,
  });
});
