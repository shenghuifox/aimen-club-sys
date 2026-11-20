import { createClient } from "npm:@supabase/supabase-js@2.95.3";

const origin = "https://shenghuifox.github.io";
const redirectTo = origin + "/aimen-club-sys/";
const headers = {
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply({ error: "不支援此操作" }, 405);
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return reply({ error: "請先登入" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!;
  const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const body = await request.json();
    if (!body || !["invite", "email", "password"].includes(body.action) ||
        (body.action !== "invite" && (typeof body.id !== "string" || !uuid.test(body.id)))) return reply({ error: "請確認帳號操作" }, 400);
    const { data: permission, error: permissionError } = await user.rpc("club_followup", {
      action: "auth_account", payload: { id: body.action === "invite" ? null : body.id },
    });
    if (permissionError) return reply({ error: permissionError.message }, 403);
    const targetId = permission?.id;
    if (body.action === "invite" ? permission?.authorized !== true : targetId !== body.id.toLowerCase()) {
      return reply({ error: "沒有操作此帳號的權限" }, 403);
    }

    const auth = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    }).auth.admin;
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (body.action !== "password" && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return reply({ error: "請輸入有效電子郵件" }, 400);
    }
    if (body.action === "invite") {
      const { data: result, error } = await user.rpc("club_import_accounts", {
        payload: { term_id: body.term_id || null, rows: [{ email, name: body.name, role: body.role, class_name: body.class_name, number: body.number }] },
      });
      if (error) return reply({ error: error.message }, 400);
      if (result?.bound === 1) return reply({ message: "既有登入帳號已綁定，可用原本的電子郵件與密碼登入。" });
      const { error: inviteError } = await auth.inviteUserByEmail(email, { redirectTo });
      if (inviteError) {
        return reply({ message: "帳號已列為待啟用，但邀請未寄出。請確認登入服務的郵件設定後重試。" });
      }
      return reply({ message: "帳號設定已儲存，已寄出登入邀請。" });
    }
    if (body.action === "password") {
      if (typeof body.password !== "string" || body.password.length < 12 || body.password.length > 72 ||
          new TextEncoder().encode(body.password).length > 72) {
        return reply({ error: "臨時密碼須至少 12 字元，且不可超過 72 個位元組。" }, 400);
      }
      const { error } = await auth.updateUserById(targetId, { password: body.password });
      if (error) return reply({ error: "無法重設密碼，請確認登入服務及密碼規則。" }, 400);
      return reply({ message: "密碼已重設，請安全交付給帳號持有人。" });
    }
    if (body.confirmed !== true) return reply({ error: "請先核對新電子郵件的持有人" }, 400);
    const { error } = await auth.updateUserById(targetId, { email, email_confirm: true });
    if (error) return reply({ error: "無法更新電子郵件。請確認電子郵件是否已被使用。" }, 400);
    return reply({ message: "登入電子郵件已更新。" });
  } catch {
    return reply({ error: "帳號服務暫時無法使用，請稍後再試。" }, 500);
  }
});
