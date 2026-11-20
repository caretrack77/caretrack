import { GoogleGenAI } from "npm:@google/genai";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const systemInstruction = "CareTrack chatbot for patients/caretakers only. Answer ONLY from given Supabase JSON. Never guess, diagnose, or use outside info. If absent, say: 'Not found in your CareTrack records.' Refuse off-topic or other-patient queries. Max 2-3 short sentences.";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const token = req.headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Unauthorized" }, 401);
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = createClient(url, anon, { auth: { persistSession: false } });
  const { data: { user }, error: authError } = await auth.auth.getUser(token);
  if (authError || !user?.email) return json({ error: "Unauthorized" }, 401);
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data: account } = await db.from("caretrack_users").select("id, role, active").eq("email", user.email).maybeSingle();
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
  const [patients, medications, appointments, doses] = await Promise.all([
    patientIds.length ? db.from("caretrack_patients").select("id,name,age,sex,conditions,allergies").in("id", patientIds).limit(10) : Promise.resolve({ data: [], error: null }),
    inScope("caretrack_medications", "patient_id,name,dosage,form,frequency,times_per_day,schedule_times,start_date,end_date,instructions,active", "created_at"),
    inScope("caretrack_appointments", "patient_id,scheduled_at,reason,status,notes", "scheduled_at"),
    inScope("caretrack_dose_logs", "patient_id,medication_id,scheduled_time,taken_time,status", "scheduled_time"),
  ]);
  if ([patients, medications, appointments, doses].some(x => x.error)) return json({ error: "Could not load CareTrack records" }, 500);
  const data = { patients: patients.data ?? [], medications: medications.data ?? [], appointments: appointments.data ?? [], doseLogs: doses.data ?? [] };
  const history = Array.isArray(input.history) ? input.history.slice(-3).filter(x => x && ["user", "model"].includes(x.role) && typeof x.text === "string").map(x => ({ role: x.role, parts: [{ text: x.text.slice(0, 500) }] })) : [];
  try {
    const ai = new GoogleGenAI({ apiKey: Deno.env.get("GEMINI_API_KEY")! });
    const response = await ai.models.generateContent({ model: "gemini-3.1-flash-lite", contents: [...history, { role: "user", parts: [{ text: `Records JSON: ${JSON.stringify(data)}\nQuestion: ${message}` }] }], config: { systemInstruction, temperature: 0, maxOutputTokens: 180 } });
    return json({ reply: response.text || "Not found in your CareTrack records." });
  } catch { return json({ error: "Assistant is temporarily unavailable" }, 502); }
});
