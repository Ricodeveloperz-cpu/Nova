import OpenAI from "openai";
import { createClient } from "@supabase/supabase-js";

export const config = { runtime: "nodejs" };

const SYSTEM_PROMPT = `
Kamu adalah Nova AI, asisten kecerdasan buatan pribadi yang natural, cerdas, profesional, hangat, dan jujur.
Gunakan Bahasa Indonesia secara default dan ikuti bahasa pengguna bila berbeda.
Pahami konteks percakapan yang diberikan; jangan meminta ulang informasi yang sudah tersedia.
Berikan jawaban yang relevan, jelas, terstruktur, dan sesuai tingkat pemahaman pengguna.
Untuk coding, hasilkan kode yang rapi, modular, aman, dan dapat dijalankan. Sebutkan nama file, dependensi, cara menjalankan, dan asumsi penting bila relevan.
Saat debugging, cari akar masalah dan jangan mengklaim sudah menguji kode bila belum benar-benar diuji.
Jangan mengarang fakta, hasil pencarian, pengujian, akses file, atau tindakan yang belum dilakukan.
Jangan mengaku dapat melihat seluruh perangkat atau file pengguna. Analisis hanya file dan data yang benar-benar diberikan melalui percakapan atau tools.
Jangan meminta atau membocorkan password, API key, token, atau rahasia lainnya.
Jangan tampilkan penalaran internal pribadi. Berikan ringkasan alasan, langkah, dan kesimpulan yang berguna.
Jika informasi tidak pasti atau tidak tersedia, katakan dengan terus terang. Jika permintaan ambigu dan detailnya penting, tanyakan satu pertanyaan paling relevan.
Jangan berpura-pura menjadi manusia. Kamu adalah Nova AI.
`;

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
});

function normalizeMessages(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 30) {
    throw new Error("Percakapan tidak valid. Maksimal 30 pesan per permintaan.");
  }

  const normalized = [];
  for (const item of input) {
    if (!item || !["user", "assistant"].includes(item.role)) continue;
    let content;

    if (typeof item.content === "string") {
      content = [{
        type: item.role === "assistant" ? "output_text" : "input_text",
        text: item.content.slice(0, 12000)
      }];
    } else if (Array.isArray(item.content)) {
      content = item.content.slice(0, 5).flatMap((part) => {
        if (part?.type === "text" && typeof part.text === "string") {
          return [{
            type: item.role === "assistant" ? "output_text" : "input_text",
            text: part.text.slice(0, 12000)
          }];
        }
        if (part?.type === "image_url" && typeof part.image_url?.url === "string") {
          const url = part.image_url.url;
          if (url.startsWith("data:image/") && url.length <= 7_000_000) {
            return [{ type: "input_image", image_url: url, detail: "auto" }];
          }
        }
        return [];
      });
    } else {
      continue;
    }

    if (content.length) normalized.push({ role: item.role, content });
  }

  if (normalized.at(-1)?.role !== "user") {
    throw new Error("Pesan terakhir harus berasal dari pengguna.");
  }
  return normalized;
}

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const {
    OPENAI_API_KEY, OPENAI_MODEL = "gpt-6-luna",
    SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
  } = process.env;

  if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Konfigurasi server belum lengkap. Periksa Environment Variables di Vercel." }, 500);
  }

  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return json({ error: "Silakan login terlebih dahulu." }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser(token);
  if (authError || !user) return json({ error: "Sesi login tidak valid. Silakan login kembali." }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Body JSON tidak valid." }, 400); }

  let input;
  try { input = normalizeMessages(body.messages); }
  catch (error) { return json({ error: error.message }, 400); }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const dailyLimit = Math.min(1000, Math.max(1, Number.parseInt(process.env.DAILY_MESSAGE_LIMIT || "100", 10) || 100));
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  const { count, error: usageError } = await db.from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", startOfDay.toISOString());

  if (usageError) return json({ error: "Tidak dapat memeriksa kuota penggunaan. Periksa tabel ai_usage." }, 500);
  if ((count || 0) >= dailyLimit) {
    return json({ error: `Batas ${dailyLimit} pesan harian sudah tercapai. Coba lagi besok.` }, 429);
  }

  try {
    const openai = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
    const stream = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions: SYSTEM_PROMPT,
      input,
      stream: true,
      store: false,
      max_output_tokens: 2200
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        let completed = false;
        try {
          for await (const event of stream) {
            if (event.type === "response.output_text.delta" && event.delta) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: event.delta })}\n\n`));
            } else if (event.type === "response.failed" || event.type === "error") {
              throw new Error("Model AI gagal menghasilkan jawaban.");
            } else if (event.type === "response.completed") {
              completed = true;
            }
          }

          if (completed) {
            const { error: insertError } = await db.from("ai_usage").insert({
              user_id: user.id,
              model: OPENAI_MODEL
            });
            if (insertError) console.error("Usage log failed:", insertError.message);
          }

          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        } catch (error) {
          console.error("Nova stream error:", error?.message || error);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Koneksi AI terputus. Silakan coba lagi." })}\n\n`));
          controller.close();
        }
      }
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch (error) {
    console.error("OpenAI request failed:", error?.message || error);
    const message = error?.status === 401
      ? "API key OpenAI tidak valid. Periksa OPENAI_API_KEY di Vercel."
      : error?.status === 429
        ? "Kuota atau saldo API OpenAI tidak mencukupi. Periksa billing API."
        : "Nova AI gagal terhubung ke model. Periksa nama model, API key, dan billing.";
    return json({ error: message }, 502);
  }
}
