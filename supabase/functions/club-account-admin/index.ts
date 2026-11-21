import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { familyRole, issueSchoolBatch, schoolBatchResolver, SCHOOL_BATCH_SIZE } from "./school-batch.js";
import { initialSchoolPassword, isInitialPassword, isSchoolAccount, schoolEmail, validSchoolPassword } from "./school-auth.js";

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
    if (!body || !["invite", "create_school", "batch_create_school", "complete_setup", "email", "password"].includes(body.action) ||
        (["email", "password"].includes(body.action) && (typeof body.id !== "string" || !uuid.test(body.id)))) {
      return reply({ error: "請確認帳號操作" }, 400);
    }
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = service.auth.admin;
    if (body.action === "complete_setup") {
      if (!validSchoolPassword(body.password) || isInitialPassword(body.password)) {
        return reply({ error: "請設定一組新的密碼，至少 8 字元，包含英文字母及數字。" }, 400);
      }
      const { data: identity, error: identityError } = await user.auth.getUser(authorization.slice(7));
      if (identityError || !identity.user) return reply({ error: "請重新登入" }, 401);
      const { data: required, error: statusError } = await user.rpc("club_school_password_required");
      if (statusError || !required) return reply({ error: "此帳號無法進行首次密碼設定" }, 403);
      const id = identity.user.id;
      const { error } = await auth.updateUserById(id, { password: body.password });
      if (error) return reply({ error: "無法更新密碼，請確認密碼規則。" }, 400);
      const { error: updateError } = await service.rpc("club_complete_school_password", { account_id: id });
      if (updateError) return reply({ error: "無法完成首次登入，請以新密碼重新登入或聯絡學校。" }, 500);
      return reply({ message: "已更新密碼。" });
    }

    const creating = ["invite", "create_school", "batch_create_school"].includes(body.action);
    const { data: permission, error: permissionError } = await user.rpc("club_followup", {
      action: "auth_account", payload: { id: creating ? null : body.id },
    });
    if (permissionError) return reply({ error: permissionError.message }, 403);
    const targetId = permission?.id;
    if (creating ? permission?.authorized !== true : targetId !== body.id.toLowerCase()) {
      return reply({ error: "沒有操作此帳號的權限" }, 403);
    }
    if (body.action === "create_school" || body.action === "batch_create_school") {
      const { data: identity, error: identityError } = await user.auth.getUser(authorization.slice(7));
      if (identityError || !identity.user) return reply({ error: "請重新登入" }, 401);
      const issuer = identity.user.id;
      async function issue(row: { username: string; name: string; role: string; student_id?: string }) {
        const alias = schoolEmail(row.username)!;
        const password = initialSchoolPassword();
        const { data: created, error } = await auth.createUser({
          email: alias, password, email_confirm: true, app_metadata: { aimen_issued_by: issuer },
        });
        if (error || !created.user) {
          if (!error?.status || error.status >= 500) throw Error("建立結果不明");
          return { error: error.code === "email_exists" || error.code === "user_already_exists"
            ? "此登入帳號已被使用。" : "無法建立校用帳號，請稍後重試。" };
        }
        const id = created.user.id;
        const username = alias.split("@")[0];
        const { error: registerError } = await user.rpc("club_register_school_account", {
          payload: { id, username, name: row.name, role: row.role, student_id: familyRole(row.role) ? row.student_id : null },
        });
        if (registerError) {
          const { error: cleanupError } = await auth.deleteUser(id);
          if (cleanupError) throw Error("建立結果不明");
          return { error: registerError.code === "P0001" ? registerError.message : "無法儲存帳號與權限，請稍後重試。" };
        }
        return { username, initial_password: password };
      }

      if (body.action === "batch_create_school") {
        if (!Array.isArray(body.rows) || body.rows.length === 0 || body.rows.length > SCHOOL_BATCH_SIZE ||
            typeof body.term_id !== "string" || !uuid.test(body.term_id)) {
          return reply({ error: "請選擇學期並確認匯入筆數。" }, 400);
        }
        const { data: snapshot, error } = await user.rpc("club_snapshot");
        if (error || !snapshot) return reply({ error: "無法確認名冊與帳號管理權限。" }, 403);
        const termId = body.term_id.toLowerCase();
        if (!snapshot.terms.some((term: { id: string; status: string }) => term.id === termId && term.status === "active")) {
          return reply({ error: "請選擇使用中的學期。" }, 400);
        }
        return reply({ results: await issueSchoolBatch(body.rows, schoolBatchResolver(snapshot, termId), issue) });
      }

      const alias = schoolEmail(body.username);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!alias || !name || name.length > 100 || !["stu", "guardian", "clubtr", "hrtr", "admin"].includes(body.role) ||
          (familyRole(body.role) && (typeof body.student_id !== "string" || !uuid.test(body.student_id)))) {
        return reply({ error: "請核對帳號、姓名、角色及綁定的學生。" }, 400);
      }
      const result = await issue({ username: alias.split("@")[0], name, role: body.role, student_id: body.student_id });
      return result.error ? reply({ error: result.error }, 400) : reply({ ...result, message: "已建立校用帳號。" });
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (body.action !== "password" && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      return reply({ error: "請輸入有效電子郵件" }, 400);
    }
    if (body.action === "invite") {
      const row = { email, name: body.name, role: body.role, class_name: body.class_name, number: body.number };
      const { data: result, error } = body.role === "admin"
        ? await user.rpc("club_prepare_admin_account", { payload: row })
        : await user.rpc("club_import_accounts", { payload: { term_id: body.term_id || null, rows: [row] } });
      if (error) return reply({ error: error.message }, 400);
      if (result?.bound === 1) return reply({ message: "既有登入帳號已綁定，可用原本的電子郵件與密碼登入。" });
      const { error: inviteError } = await auth.inviteUserByEmail(email, { redirectTo });
      if (inviteError) {
        return reply({ message: "帳號已列為待啟用，但邀請未寄出。請確認登入服務的郵件設定後重試。" });
      }
      return reply({ message: "帳號設定已儲存，已寄出登入邀請。" });
    }
    if (body.action === "password") {
      if (!validSchoolPassword(body.password)) {
        return reply({ error: "密碼須至少 8 字元，包含英文字母與數字，且最多 72 位元組。" }, 400);
      }
      const { error } = await auth.updateUserById(targetId, { password: body.password });
      if (error) return reply({ error: "無法重設密碼，請確認登入服務及密碼規則。" }, 400);
      return reply({ message: "密碼已重設，請安全交付給帳號持有人。" });
    }
    if (body.confirmed !== true) return reply({ error: "請先核對新電子郵件的持有人" }, 400);
    const { data: target, error: lookupError } = await auth.getUserById(targetId);
    if (lookupError || !target.user || isSchoolAccount(target.user.email) || isSchoolAccount(email)) {
      return reply({ error: "校用登入帳號無法改用電子郵件。" }, 400);
    }
    const { error } = await auth.updateUserById(targetId, { email, email_confirm: true });
    if (error) return reply({ error: "無法更新電子郵件。請確認電子郵件是否已被使用。" }, 400);
    return reply({ message: "登入電子郵件已更新。" });
  } catch {
    return reply({ error: "帳號服務暫時無法使用，請稍後再試。" }, 500);
  }
});
