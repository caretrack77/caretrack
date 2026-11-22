import { GoogleGenAI } from "npm:@google/genai";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const systemInstruction = "CareTrack chatbot for patients/caretakers only. Answer ONLY from the supplied CareTrack records. Answer in the same language as the user's question. For dates and schedules, use the exact supplied values and do not calculate or guess. Never diagnose or use outside information. If information is absent, say it is not found in CareTrack records. Refuse off-topic or other-patient queries. Keep answers to 2-3 short sentences.";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const decode = (part: string) => Uint8Array.from(atob(part.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((part.length + 3) % 4)), c => c.charCodeAt(0));

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Unauthorized" }, 401);
  const [head, body, sig, ...extra] = token.split("."), secret = Deno.env.get("GEMINI_ASSISTANT_JWT_SECRET");
  if (!head || !body || !sig || extra.length || !secret) return json({ error: "Unauthorized" }, 401);
  let claims: { sub?: string; aud?: string; iat?: number; exp?: number };
  try {
    const header = JSON.parse(new TextDecoder().decode(decode(head)));
    claims = JSON.parse(new TextDecoder().decode(decode(body)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
    if (header.alg !== "HS256" || !await crypto.subtle.verify("HMAC", key, decode(sig), new TextEncoder().encode(`${head}.${body}`))) return json({ error: "Unauthorized" }, 401);
  } catch { return json({ error: "Unauthorized" }, 401); }
  const now = Math.floor(Date.now() / 1000), userId = Number(claims.sub);
  if (!Number.isSafeInteger(userId) || claims.aud !== "caretrack-gemini" || !claims.exp || claims.exp <= now || !claims.iat || claims.iat > now + 15) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key || !Deno.env.get("GEMINI_API_KEY")) return json({ error: "Assistant is not configured" }, 503);
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: account } = await db.from("caretrack_users").select("id, role, active").eq("id", userId).maybeSingle();
  if (!account?.active || !["patient", "caretaker", "caregiver"].includes(account.role)) return json({ error: "Forbidden" }, 403);

  let input: { message?: string; history?: { role: "user" | "model"; text: string }[] };
  try { input = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 500) : "";
  if (!message) return json({ error: "Message is required" }, 400);
  let patientIds: number[] = [];
  if (account.role === "patient") {
    const { data } = await db.from("caretrack_patients").select("id").eq("user_id", account.id).limit(10);
    patientIds = (data ?? []).map(x => x.id);
  } else {
    const { data } = await db.from("caretrack_patient_caregiver_assignments").select("patient_id").eq("caregiver_id", account.id).limit(10);
    patientIds = [...new Set((data ?? []).map(x => x.patient_id))];
  }
  const inScope = (table: string, columns: string, order: string) => patientIds.length
    ? db.from(table).select(columns).in("patient_id", patientIds).order(order, { ascending: false }).limit(12)
    : Promise.resolve({ data: [] as Record<string, unknown>[], error: null });
  const [patients, medications, appointments, doses, healthMetrics, healthLogs, medicalHistory, labResults] = await Promise.all([
    patientIds.length ? db.from("caretrack_patients").select("id,name,age,sex,conditions,allergies").in("id", patientIds).limit(10) : Promise.resolve({ data: [], error: null }),
    inScope("caretrack_medications", "patient_id,name,dosage,form,frequency,times_per_day,schedule_times,start_date,end_date,instructions,active", "created_at"),
    inScope("caretrack_appointments", "patient_id,scheduled_at,reason,status,notes", "scheduled_at"),
    inScope("caretrack_dose_logs", "patient_id,medication_id,scheduled_time,taken_time,status", "scheduled_time"),
    inScope("caretrack_health_metrics", "patient_id,metric_type,value,secondary_value,unit,recorded_at,out_of_range", "recorded_at"),
    inScope("caretrack_health_logs", "patient_id,recorded_at,symptoms,notes", "recorded_at"),
    inScope("caretrack_medical_history", "patient_id,occurred_on,title,notes,active", "occurred_on"),
    inScope("caretrack_lab_results", "patient_id,category,title,notes,review_comment,reviewed_at,created_at", "created_at"),
  ]);
  if ([patients, medications, appointments, doses, healthMetrics, healthLogs, medicalHistory, labResults].some(x => x.error)) return json({ error: "Could not load CareTrack records" }, 500);
  const data = {
    patients: patients.data ?? [],
    medications: medications.data ?? [],
    appointments: appointments.data ?? [],
    doseLogs: doses.data ?? [],
    healthMetrics: healthMetrics.data ?? [],
    healthLogs: healthLogs.data ?? [],
    medicalHistory: medicalHistory.data ?? [],
    labResults: labResults.data ?? [],
  };
  const history = Array.isArray(input.history) ? input.history.slice(-6).filter(x => x && ["user", "model"].includes(x.role) && typeof x.text === "string").map(x => ({ role: x.role, parts: [{ text: x.text.slice(0, 500) }] })) : [];
  try {
    const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY")! });
    const response = await ai.models.generateContent({ model: "gemini-3.1-flash-lite", contents: [...history, { role: "user", parts: [{ text: `Records JSON: ${JSON.stringify(data)}\nQuestion: ${message}` }] }], config: { systemInstruction, temperature: 0, maxOutputTokens: 180 } });
    return json({ reply: response.text || "Not found in your CareTrack records." });
  } catch { return json({ error: "Assistant is temporarily unavailable" }, 502); }
});
