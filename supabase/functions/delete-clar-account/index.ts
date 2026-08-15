// delete-clar-account — vollständige Konto-Löschung über alle clar-Apps.
// Apple Guideline 5.1.1(v): Account deletion muss in der App möglich sein.
//
// Löscht best-effort alle Nutzerdaten in clar_log, clar_tag, clar_markt und
// public (clar·heim + Shell-Tabellen) und danach VERBINDLICH den Auth-User.
// Einzelne Tabellen-Fehler (z. B. umbenannte Tabellen) brechen den Vorgang
// nicht ab — sie werden gesammelt und geloggt. Schlägt die Auth-User-Löschung
// fehl, ist der gesamte Vorgang fehlgeschlagen (Status 500).
//
// Aufruf: POST mit JSON { accessToken } (gleiches Muster wie clar-log/delete-account).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { accessToken } = await req.json();
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, { auth: { persistSession: false } });
    const { data: userData } = await userClient.auth.getUser(accessToken);
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = userData.user.id;
    const email = (userData.user.email ?? "").toLowerCase();

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const failures: string[] = [];

    // Best-effort-Wrapper: Fehler sammeln, weitermachen.
    // deno-lint-ignore no-explicit-any
    const run = async (label: string, p: PromiseLike<{ error: any }>) => {
      try {
        const { error } = await p;
        if (error) failures.push(`${label}: ${error.message}`);
      } catch (e) {
        failures.push(`${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    };

    // ── clar_log (identisch zur bestehenden delete-account-Funktion) ──
    {
      const cl = admin.schema("clar_log");
      await run("log.observer_observations(owner)", cl.from("observer_observations").delete().eq("owner_id", userId));
      await run("log.observer_observations(observer)", cl.from("observer_observations").delete().eq("observer_user_id", userId));
      await run("log.word_reports", cl.from("word_reports").delete().eq("user_id", userId));
      await run("log.daily_logs", cl.from("daily_logs").delete().eq("user_id", userId));
      await run("log.observer_links", cl.from("observer_links").delete().eq("owner_id", userId));
      await run("log.teacher_links", cl.from("teacher_links").delete().eq("owner_id", userId));
      await run("log.doctor_links", cl.from("doctor_links").delete().eq("owner_id", userId));
      await run("log.teen_tokens", cl.from("teen_tokens").delete().eq("owner_id", userId));
      await run("log.observers(owner)", cl.from("observers").delete().eq("owner_id", userId));
      await run("log.observers(observer)", cl.from("observers").delete().eq("observer_user_id", userId));
      await run("log.observation_periods", cl.from("observation_periods").delete().eq("user_id", userId));
      await run("log.tracker_logs", cl.from("tracker_logs").delete().eq("user_id", userId));
      await run("log.tracker_settings", cl.from("tracker_settings").delete().eq("user_id", userId));
      await run("log.family_members(admin)", cl.from("family_members").delete().eq("admin_user_id", userId));
      await run("log.family_members(member)", cl.from("family_members").delete().eq("member_user_id", userId));
      await run("log.family_invites", cl.from("family_invites").delete().eq("admin_user_id", userId));
      await run("log.user_consents", cl.from("user_consents").delete().eq("user_id", userId));
    }

    // ── clar_tag (Logik aus clar-tag/src/lib/account.functions.ts) ──
    {
      const ct = admin.schema("clar_tag");
      try {
        const { data: families } = await ct.from("families").select("id").eq("admin_user_id", userId);
        const familyIds = (families ?? []).map((f: { id: string }) => f.id);
        if (familyIds.length > 0) {
          const { data: members } = await ct.from("family_members").select("id, user_id").in("family_id", familyIds);
          const memberIds = (members ?? []).map((m: { id: string }) => m.id);
          const memberUserIds = (members ?? [])
            .map((m: { user_id: string | null }) => m.user_id)
            .filter((u: string | null): u is string => !!u && u !== userId);
          if (memberIds.length > 0) {
            await run("tag.family_member_status", ct.from("family_member_status").delete().in("member_id", memberIds));
          }
          await run("tag.family_invites", ct.from("family_invites").delete().in("family_id", familyIds));
          await run("tag.family_members", ct.from("family_members").delete().in("family_id", familyIds));
          await run("tag.families", ct.from("families").delete().in("id", familyIds));
          // Anonyme Familien-Auth-User entfernen (nur anonyme!)
          for (const uid of memberUserIds) {
            try {
              const { data: u } = await admin.auth.admin.getUserById(uid);
              if (u?.user?.is_anonymous) await admin.auth.admin.deleteUser(uid);
            } catch (e) {
              failures.push(`tag.anon-user ${uid}: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      } catch (e) {
        failures.push(`tag.families-cascade: ${e instanceof Error ? e.message : String(e)}`);
      }
      for (const table of ["workflow_completions", "workflow_schedules", "workflow_recurrences", "workflows", "calendar_tokens", "profiles"]) {
        await run(`tag.${table}`, ct.from(table).delete().eq("user_id", userId));
      }
    }

    // ── clar_markt (Logik aus clar-markt/src/lib/admin.server.ts hardCleanup) ──
    {
      const cm = admin.schema("clar_markt");
      try {
        const { data: adminMembership } = await cm
          .from("group_members").select("group_id")
          .eq("user_id", userId).eq("role", "admin").eq("status", "active");
        for (const m of adminMembership ?? []) {
          const groupId = (m as { group_id: string }).group_id;
          const { data: lists } = await cm.from("shopping_lists").select("id").eq("group_id", groupId);
          const listIds = (lists ?? []).map((l: { id: string }) => l.id);
          if (listIds.length > 0) {
            await run("markt.shopping_items", cm.from("shopping_items").delete().in("list_id", listIds));
            await run("markt.shopping_lists", cm.from("shopping_lists").delete().in("id", listIds));
          }
          await run("markt.meals", cm.from("meals").delete().eq("group_id", groupId));
          await run("markt.week_plan", cm.from("week_plan").delete().eq("group_id", groupId));
          await run("markt.group_members(group)", cm.from("group_members").delete().eq("group_id", groupId));
          await run("markt.group_category_habits", cm.from("group_category_habits").delete().eq("group_id", groupId));
          await run("markt.group_learned_prices", cm.from("group_learned_prices").delete().eq("group_id", groupId));
          await run("markt.groups", cm.from("groups").delete().eq("id", groupId));
        }
      } catch (e) {
        failures.push(`markt.groups-cascade: ${e instanceof Error ? e.message : String(e)}`);
      }
      await run("markt.group_members(user)", cm.from("group_members").delete().eq("user_id", userId));
      await run("markt.banner_seen", cm.from("banner_seen").delete().eq("user_id", userId));
      await run("markt.consent_log", cm.from("consent_log").delete().eq("user_id", userId));
      await run("markt.profiles", cm.from("profiles").delete().eq("user_id", userId));
      await run("markt.subscribers", cm.from("subscribers").delete().eq("user_id", userId));
      if (email) await run("markt.subscribers(email)", cm.from("subscribers").delete().ilike("email", email));
    }

    // ── public: clar·heim (aus clar-heim/src/lib/account.functions.ts) + Shell ──
    {
      const pb = admin.schema("public");
      try {
        const { data: households } = await pb.from("households").select("id").eq("created_by", userId);
        const householdIds = (households ?? []).map((h: { id: string }) => h.id);
        if (householdIds.length > 0) {
          await run("heim.tasks(household)", pb.from("tasks").delete().in("household_id", householdIds));
          const { data: workflows } = await pb.from("household_workflows").select("id").in("household_id", householdIds);
          const workflowIds = (workflows ?? []).map((w: { id: string }) => w.id);
          if (workflowIds.length > 0) {
            await run("heim.household_workflow_steps", pb.from("household_workflow_steps").delete().in("household_workflow_id", workflowIds));
          }
          await run("heim.household_workflows", pb.from("household_workflows").delete().in("household_id", householdIds));
          await run("heim.invitations", pb.from("invitations").delete().in("household_id", householdIds));
          await run("heim.profiles(unlink)", pb.from("profiles").update({ household_id: null, role: "member", is_captain: false }).in("household_id", householdIds));
          await run("heim.households", pb.from("households").delete().in("id", householdIds));
        }
      } catch (e) {
        failures.push(`heim.households-cascade: ${e instanceof Error ? e.message : String(e)}`);
      }
      await run("heim.tasks(assigned)", pb.from("tasks").delete().eq("assigned_to", userId));
      await run("heim.profiles", pb.from("profiles").delete().eq("user_id", userId));
      await run("public.app_memberships", pb.from("app_memberships").delete().eq("user_id", userId));
      await run("public.consent_log", pb.from("consent_log").delete().eq("user_id", userId));
      await run("public.subscribers", pb.from("subscribers").delete().eq("user_id", userId));
      if (email) await run("public.subscribers(email)", pb.from("subscribers").delete().ilike("email", email));
      // Shell/Apple-Tabellen
      await run("public.apple_subscriptions", pb.from("apple_subscriptions").delete().eq("user_id", userId));
      await run("public.apple_subscription_intents", pb.from("apple_subscription_intents").delete().eq("user_id", userId));
      await run("public.audit_log", pb.from("audit_log").delete().eq("user_id", userId));
    }

    if (failures.length > 0) {
      console.error("[delete-clar-account] best-effort failures:", failures);
    }

    // ── VERBINDLICH: Auth-User löschen ──
    const { error: authErr } = await admin.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error("[delete-clar-account] auth delete failed:", authErr);
      return new Response(JSON.stringify({ error: "Account deletion failed", detail: authErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, warnings: failures.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[delete-clar-account]", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
