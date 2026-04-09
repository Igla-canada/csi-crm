# Car Systems CRM

Car Systems CRM is a branded MVP for a car systems installation business. It combines:

- client management
- structured call logging
- appointment booking with capacity rules
- CSV import for retroactive history
- role-based views
- operational reporting

## Stack

- Next.js 16 App Router
- TypeScript
- Supabase (PostgreSQL via `@supabase/supabase-js`, service role on the server)
- Tailwind CSS 4

## Local Setup

1. Create a Supabase project and run `database/schema.sql` in the SQL Editor (empty `public` schema), unless you already have compatible tables from a prior setup.

2. Copy `.env.example` to `.env` and set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and **`SUPABASE_SERVICE_ROLE_KEY`** (server-only).

3. Install dependencies:

```bash
npm install
```

4. Seed demo data (wipes and repopulates public CRM tables):

```bash
npm run db:seed
```

5. Start the app:

```bash
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Demo Users

Use the header role switcher to view the CRM as different staff personas:

- `admin@carsystemscrm.local`
- `manager@carsystemscrm.local`
- `sales@carsystemscrm.local`
- `tech@carsystemscrm.local`

## Implemented MVP Areas

### User flows

- Reception/sales can search callers, log call notes, and create bookings quickly.
- Managers can review imports, bookings, reporting, and team roles.
- Tech users can see job context, client history, and appointment details.

### Data model

The database includes (among others):

- `User`
- `Client`
- `ContactPoint`
- `Vehicle`
- `CallLog`
- `CallResultOption`
- `Opportunity`
- `Appointment`
- `ImportBatch`
- `ImportRow`
- `CalendarConfig`
- `AuditLog`

### CSV import rules

- normalizes phone numbers before matching
- creates clients when no phone match exists
- stores every source row in `ImportRow`
- creates historical call logs and opportunity records from imported rows
- flags review cases when matching needs confirmation

### Booking model

- stores appointments with `resourceKey` and `capacitySlot`
- supports overlapping slots using configurable parallel capacity
- keeps `googleEventId` and sync state on appointments so real Google Calendar sync can be attached next

### Reporting

- lead sources
- call outcomes
- staff activity
- product / service demand mix

## Verification

The current project passes:

```bash
npm run lint
npm run build
```
