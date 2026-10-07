# Booking App — Setup (Self-Host)

A Cal.com-style booking app. Backend: Supabase (Postgres via PostgREST).
Email: Resend (optional). No paid SDK dependencies — uses native `fetch`.

## Prerequisites
- Node.js 20+
- A free Supabase project — https://supabase.com
- (Optional) A Resend account + verified sending domain — https://resend.com

## 1. Install
```bash
npm install
```

## 2. Create the database schema
Open your Supabase project → **SQL Editor** → paste the contents of
[`migrations/booking.sql`](./migrations/booking.sql) → **Run**.
This creates 3 tables and seeds a default availability row.

## 3. Configure environment
```bash
cp .env.example .env.local
```
Fill in `.env.local`:
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase → Settings → API
- `RESEND_API_KEY` + `BOOKING_FROM_EMAIL` — only for email; leave the key empty
  to disable sending (the app logs `[EMAIL SKIPPED]` instead).
- `NEXT_PUBLIC_BASE_PATH` — leave **empty** for a standalone deploy at the root.

> `.env.local` holds secrets and is gitignored — never commit or ship it.

## 4. Run
```bash
npm run dev          # http://localhost:3206
# or for production
npm run build && npm run start
```

## 5. Use
- Admin dashboard: `/admin` — bookings, availability, event types
- Public booking page: `/book`

## Security notes
- The `service_role` key bypasses Row Level Security and is read only in
  server-side API routes (`src/lib/supabase.ts`). It is never sent to the client.
- Each installer uses their **own** Supabase + Resend accounts. No credentials
  are bundled in this package — `.env.local` is gitignored.
