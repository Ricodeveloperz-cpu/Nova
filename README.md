# Nova AI v2.0 — Vercel + OpenAI Responses API + Supabase

Nova AI adalah starter chatbot AI dengan UI Neobrutalism, streaming jawaban, autentikasi, riwayat percakapan, upload gambar/teks, dan dashboard admin. Frontend statis dan API berjalan sebagai Vercel Functions; tidak memerlukan VPS.

## Pembaruan v2.0
- Backend menggunakan OpenAI Responses API (`openai.responses.create`) dengan streaming.
- System instructions Nova AI diletakkan di server, bukan dikirim oleh browser.
- `store: false` untuk tidak meminta penyimpanan response di OpenAI.
- Validasi input, otorisasi Supabase, batas pesan harian, dan error handling diperketat.
- API key hanya dibaca dari environment server.
- Endpoint admin memeriksa email admin dan menangani error database.
- UI tetap menggunakan tema Neobrutalism dan mendukung layar ponsel.

## 1. Buat Supabase
1. Buat project di https://supabase.com.
2. Buka SQL Editor dan jalankan `supabase/schema.sql`.
3. Buka Project Settings → API. Salin Project URL, anon/publishable key, dan service_role key.
4. Authentication → URL Configuration: isi Site URL dan Redirect URLs dengan domain Vercel kamu.

## 2. Konfigurasi frontend
Edit `public/app.js`:
```js
const SUPABASE_URL = "https://PROJECT_ID.supabase.co";
const SUPABASE_ANON_KEY = "SUPABASE_ANON_OR_PUBLISHABLE_KEY";
```
Anon/publishable key boleh digunakan browser jika RLS aktif. Jangan pernah masukkan service_role key ke frontend.

## 3. Deploy ke Vercel
1. Upload isi folder project ke repository GitHub.
2. Import repository di https://vercel.com.
3. Framework preset: Other; Root Directory: `./`.
4. Tambahkan Environment Variables:
   - `OPENAI_API_KEY`: API key BARU dari https://platform.openai.com/api-keys
   - `OPENAI_MODEL`: `gpt-6-luna` sebagai default; ganti hanya dengan model yang tersedia pada akun API kamu.
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (rahasia, server-only)
   - `ADMIN_EMAILS`: email admin, misalnya `nama@email.com`
   - `DAILY_MESSAGE_LIMIT`: misalnya `100`
5. Deploy atau redeploy setelah mengubah environment variables.

## 4. Lokal (opsional)
```bash
npm install
cp .env.example .env
# Isi .env dengan kredensial milikmu
npm run dev
```
Isi juga konstanta Supabase di `public/app.js`.

## Database
Jalankan `supabase/schema.sql` satu kali. Jika tabel/policy sudah dibuat dari versi lama, jangan jalankan ulang policy `create policy` tanpa memeriksa apakah policy dengan nama yang sama sudah ada. Untuk instalasi baru, file SQL ini dapat dijalankan langsung.

## Catatan keamanan
- API key yang pernah dibagikan di chat harus segera dicabut (revoke) dan diganti.
- Jangan pernah commit `.env` ke GitHub.
- `SUPABASE_SERVICE_ROLE_KEY` hanya boleh berada di Vercel Environment Variables atau `.env` lokal.
- ChatGPT Plus/Free tidak mencakup kredit API OpenAI; billing API terpisah.
- Model dan fitur yang tersedia bergantung pada akses API akun OpenAI.
- Upload gambar dibatasi 5 MB di browser. File teks dibatasi 20.000 karakter.
- PDF/DOCX belum didukung dalam starter ini.
- Kuota harian merupakan pembatasan dasar, bukan perlindungan anti-abuse tingkat enterprise.
