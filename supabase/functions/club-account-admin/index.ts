import { createClient } from "npm:@supabase/supabase-js@2.95.3";
import { familyRole, issueSchoolBatch, schoolBatchResolver, SCHOOL_BATCH_SIZE } from "./school-batch.js";
import { randomHex, studentHashes, studentResolver, setupCode, digest, teacherDefault } from "./student-access.js";
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
    if (!body || !["invite", "create_school", "batch_create_school", "provision_students", "complete_setup", "email", "password", "admin_reset", "teacher_reset"].includes(body.action) ||
        (["email", "password", "admin_reset", "teacher_reset"].includes(body.action) && (typeof body.id !== "string" || !uuid.test(body.id)))) {
      return reply({ error: "請確認帳號操作" }, 400);
    }
    const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const auth = service.auth.admin;
    if (body.action === "admin_reset") {
      const {data:email,error}=await user.rpc("club_admin_reset_email",{account_id:body.id});
      if(error||!email)return reply({error:error?.message||"此帳號無法收取重設信。"},403);
      const sender=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{auth:{persistSession:false}});
      const {error:sendError}=await sender.auth.resetPasswordForEmail(email,{redirectTo});
      if(sendError)return reply({error:"無法寄出重設信，請確認郵件服務與配額。"},502);
      return reply({message:"已向對方已驗證的 Email 寄出重設通知。"});
    }
    if (body.action === "complete_setup") {
      if (!validSchoolPassword(body.password) || isInitialPassword(body.password)) {
        return reply({ error: "請設定一組新的密碼，至少 8 字元，包含英文字母及數字。" }, 400);
      }
      const { data: identity, error: identityError } = await user.auth.getUser(authorization.slice(7));
      if (identityError || !identity.user) return reply({ error: "請重新登入" }, 401);
      const setupDigest=identity.user.app_metadata?.aimen_teacher_setup;
      const username=identity.user.email?.split("@")[0]||"";
      if (setupDigest && (typeof body.teacher_code!=="string" || await digest(body.teacher_code)!==setupDigest
        || body.password===teacherDefault(username))) {
        return reply({error:"請從老師入口使用初始密碼與啟用碼重新登入，並設定不同的新密碼。"},400);
      }
      const { data: required, error: statusError } = await user.rpc("club_school_password_required");
      if (statusError || !required) return reply({ error: "此帳號無法進行首次密碼設定" }, 403);
      const id = identity.user.id;
      const { error } = await auth.updateUserById(id, { password: body.password });
      if (error) return reply({ error: "無法更新密碼，請確認密碼規則。" }, 400);
      const { error: updateError } = await service.rpc("club_complete_school_password", { account_id: id });
      if (updateError) return reply({ error: "無法完成首次登入，請以新密碼重新登入或聯絡學校。" }, 500);
      return reply({ message: "已更新密碼。" });
    }

    const creating = ["invite", "create_school", "batch_create_school", "provision_students"].includes(body.action);
    const { data: permission, error: permissionError } = await user.rpc("club_followup", {
      action: "auth_account", payload: { id: creating ? null : body.id },
    });
    if (permissionError) return reply({ error: permissionError.message }, 403);
    const targetId = permission?.id;
    if (creating ? permission?.authorized !== true : targetId !== body.id.toLowerCase()) {
      return reply({ error: "沒有操作此帳號的權限" }, 403);
    }
    if (["create_school", "batch_create_school", "provision_students"].includes(body.action)) {
      const { data: identity, error: identityError } = await user.auth.getUser(authorization.slice(7));
      if (identityError || !identity.user) return reply({ error: "請重新登入" }, 401);
      const issuer = identity.user.id;
      async function issue(row: { username: string; name: string; role: string; student_id?: string },
        roster?: Record<string, unknown>) {
        const alias = schoolEmail(row.username)!;
        const password = initialSchoolPassword();
        const teacherCode = roster ? "" : setupCode(16);
        const { data: created, error } = await auth.createUser({
          email: alias, password, email_confirm: true, app_metadata: {
            aimen_issued_by: issuer,
            ...(teacherCode ? {aimen_teacher_setup:await digest(teacherCode)} : {}),
          },
        });
        if (error || !created.user) {
          if (!error?.status || error.status >= 500) throw Error("建立結果不明");
          return { error: error.code === "email_exists" || error.code === "user_already_exists"
            ? "此登入帳號已被使用。" : "無法建立校用帳號，請稍後重試。" };
        }
        const id = created.user.id;
        const username = alias.split("@")[0];
        const { error: registerError } = await user.rpc(roster ? "club_provision_student" : "club_register_school_account", {
          payload: { id, username, name: row.name, role: row.role, student_id: familyRole(row.role) ? row.student_id : null, ...roster },
        });
        if (registerError) {
          const { error: cleanupError } = await auth.deleteUser(id);
          if (cleanupError) throw Error("建立結果不明");
          return { error: registerError.code === "P0001" ? registerError.message : "無法儲存帳號與權限，請稍後重試。" };
        }
        return { username, ...(teacherCode ? {initial_password:teacherDefault(username),teacher_code:teacherCode} : {}) };
      }

      if (body.action === "batch_create_school" || body.action === "provision_students") {
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
        if (body.action === "batch_create_school") {
          return reply({ results: await issueSchoolBatch(body.rows, schoolBatchResolver(snapshot, termId), row =>
            row.role === "stu" || row.role === "guardian" ? {error:"此身分請使用學生管理。"} : issue(row)) });
        }
        const resolve = studentResolver(snapshot, termId);
        const results = [];
        for (const raw of body.rows) {
          let row;
          try { row = resolve(raw); } catch (error) {
            results.push({status:"failed",error:error instanceof Error ? error.message : "請核對名冊。"});
            continue;
          }
          const replace = body.replace === true && body.rows.length === 1;
          if (row.alreadyBound && (!row.openid || row.hasLink && !replace)) {
            results.push({status:"skipped",error:row.hasLink ? "已發行登入連結。需更新時請個別補發。" : "帳號已建立，尚未填入 OpenID。"});
            continue;
          }
          try {
            const card = row.openid ? setupCode(12) : "";
            const {class_name,number,name} = row;
            const payload = {class_name,number,name,term_id:termId,replace,
              ...(card ? await studentHashes(card,row.openid) : {})};
            const result = row.alreadyBound
              ? await user.rpc("club_provision_student",{payload})
              : await issue({username:"s-"+randomHex(12),name,role:"stu"},payload);
            if (result.error) {
              results.push({status:"failed",error:typeof result.error==="string" ? result.error : result.error.message});
              continue;
            }
            results.push({status:"created",student_link:card ? redirectTo+"#student="+card : null});
          } catch {
            results.push({status:"unknown",error:"結果待確認，請查看學生管理。"});
          }
        }
        return reply({results});
      }

      const alias = schoolEmail(body.username);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!alias || !name || name.length > 100 || !["clubtr", "hrtr"].includes(body.role) ||
          (familyRole(body.role) && (typeof body.student_id !== "string" || !uuid.test(body.student_id)))) {
        return reply({ error: "請核對帳號、姓名、角色及綁定的學生。" }, 400);
      }
      const result = await issue({ username: alias.split("@")[0], name, role: body.role, student_id: body.student_id });
      return result.error ? reply({ error: result.error }, 400) : reply({ ...result, message: "已建立校用帳號。" });
    }
    if (body.action === "teacher_reset") {
      const {data:target,error}=await auth.getUserById(targetId);
      if(error||!isSchoolAccount(target.user?.email))return reply({error:"此帳號請透過既有電子郵件重設。"},400);
      const username=target.user!.email!.split("@")[0],teacherCode=setupCode(16);
      const {error:setupError}=await service.rpc("club_require_teacher_password",{account_id:targetId});
      if(setupError)return reply({error:"此帳號無法發行老師啟用碼。"},400);
      const {error:resetError}=await auth.updateUserById(targetId,{password:initialSchoolPassword(),
       app_metadata:{aimen_teacher_setup:await digest(teacherCode)}});
      if(resetError)return reply({error:"尚未完成重設，請重新發行啟用碼。"},502);
      return reply({username,initial_password:teacherDefault(username),teacher_code:teacherCode,message:"已重設老師初始密碼。"});
    }
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    if (body.action !== "password" && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith(".invalid"))) {
      return reply({ error: "請輸入有效電子郵件" }, 400);
    }
    if (body.action === "invite") {
      if (!["admin", "clubtr", "hrtr"].includes(body.role)) return reply({error:"請選擇教職員角色。"},400);
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
