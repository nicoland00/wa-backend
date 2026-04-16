# Pastora New Resolutions: Technical Plan

## Goal

Translate the six "Pastora new resolutions" into an implementation plan grounded in the current `wa-backend` codebase.

This repo is a Next.js app with:

- UI pages under `app/dashboard/*` and `app/login/page.tsx`
- server routes under `app/api/*`
- auth/session code in `lib/authOptions.ts` and `lib/server/auth.ts`
- domain/data types in `lib/db/types.ts`
- Ixorigue integration in `lib/ixorigue/client.ts`

## Current State Summary

### Auth and login

- Google login is handled by NextAuth in `lib/authOptions.ts`.
- The login UI lives in `app/login/page.tsx`.
- Logout is triggered from `app/dashboard/page.tsx` with `signOut({ callbackUrl: "/login" })`.
- Sign-in auto-upserts a local user by email on first login.
- There is no explicit account-picker enforcement after logout, so account switching can depend on Google session state.

### Roles and permissions

- `Role` is currently only `"admin" | "user"` in `lib/db/types.ts`.
- Most route protection relies on `isAdmin()` in `lib/server/auth.ts`.
- Admin pages hardcode `session.user.role === "admin"`.
- There is no read-only admin-like role yet.

### Dashboard and map

- Main dashboard is `app/dashboard/page.tsx`.
- The page already supports ranch selection for both admins and non-admins.
- Ranch summary exists, but it is rendered in the right-side aside, not next to the selectors.
- Lot filtering exists, but it also lives in the right-side aside instead of the top bar.
- Map data comes from `app/api/map/ranch/[id]/route.ts`.
- `components/MapView.tsx` renders lots and animal points, but it does not expose animal hover/click details.

### Ranches, animals, and ownership

- Admin ranch explorer lives in `app/dashboard/admin/ranches/page.tsx`.
- Ranch assignment is handled by `app/api/admin/ranches/assign/route.ts` plus `lib/server/ranches.ts`.
- There is currently no ranch delete endpoint.
- The codebase does not contain hardcoded references to "Gustavo Ledezma" or "Luis Abalo", so that issue likely comes from persisted data or owner assignment rules.

### User management and phone approval

- Admin users page is `app/dashboard/admin/users/page.tsx`.
- Admin phones page is already split out in `app/dashboard/admin/phones/page.tsx`.
- Even so, the users page still mixes role actions with a direct "Approve phone" action.
- "Create user" exists in `app/api/admin/users/route.ts`, but Google sign-in already creates users automatically, so this flow is now conceptually redundant unless we want manual pre-provisioning.

### Ixorigue token handling

- `lib/ixorigue/client.ts` reads credentials from env vars only.
- Current refresh flow supports:
  - `IXORIGUE_AUTH_TOKEN`
  - `IXORIGUE_REFRESH_TOKEN`
  - `IXORIGUE_API_KEY`
- There is no admin UI or DB-backed credential store for rotating the refresh token.

## Recommended Delivery Order

### Phase 1: permissions foundation

1. Introduce the new role model and permission helpers.
2. Enforce self-protection rules on user management endpoints.
3. Separate phone approval from user-role management in UI and API.

### Phase 2: dashboard and map UX

1. Rework selector/header layout.
2. Add lot/animal side panel behavior and animal hover details.
3. Verify ranch-filtered data consistency for admin and non-admin users.

### Phase 3: ranch management

1. Add safe ranch removal flow.
2. Validate cascade effects on lots, animals, imports, and sync jobs.
3. Clean up any bad ownership data already in Mongo.

### Phase 4: Ixorigue credential administration

1. Move refresh-token storage behind an admin-safe persistence layer.
2. Add admin UI to update/test credentials.
3. Keep env vars only as bootstrap/fallback.

## Detailed Plan

## 1. Auth / Login

### Problems to solve

- Google account switching is unreliable after logout.
- Session/login behavior should make user switching explicit.

### Code areas

- `app/login/page.tsx`
- `lib/authOptions.ts`
- `app/dashboard/page.tsx`

### Proposed changes

- Force Google account selection on sign-in.
  - Preferred implementation: configure Google auth params with `prompt=select_account`.
- Keep logout simple, but verify that local NextAuth session is fully cleared before redirect.
- Add a short login hint if needed: "Choose the Google account you want to use for Pastora."

### Acceptance criteria

- After logout, the next login flow consistently offers account choice.
- Switching from user A to user B does not keep the previous session in Pastora.

### Risk

- Google cookies cannot be fully controlled by our app, so the reliable fix is to force account selection during sign-in rather than trying to "log out of Google".

## 2. Dashboard / Navigation

### Problems to solve

- Non-admin users need the lot selector at the top.
- Admin users need the lot selector next to the ranch selector.
- Ranch summary should be visible in the header next to ranch and lot context.

### Code areas

- `app/dashboard/page.tsx`
- `components/MapView.tsx`

### Proposed changes

- Refactor the dashboard header into a shared top control bar containing:
  - ranch selector
  - lot selector
  - compact ranch summary
- Keep admin-only links separate from the selection controls.
- Move the current lot filter out of the right-side aside.
- Keep imports below the map, but make the active ranch/lot context visible above the fold.

### Notes

- The dashboard already fetches ranches differently for admin vs non-admin, so this is mainly a layout/state refactor, not a new data model.

### Acceptance criteria

- Non-admin users see ranch + lot controls at the top.
- Admin users also see lot selection adjacent to ranch selection.
- Ranch summary is visible without scrolling to the right-side panel.

## 3. Ranch / Animals / Map

### Problems to solve

- Animals must respect the selected ranch.
- Need to investigate incorrect ranch ownership/display for the Gustavo/Luis case.
- Need a side panel next to the map with animals for the selected lot.
- Need hover details for animals on the map.
- Imports should remain below the map.

### Code areas

- `app/dashboard/page.tsx`
- `app/dashboard/admin/ranches/page.tsx`
- `app/api/map/ranch/[id]/route.ts`
- `components/MapView.tsx`
- `lib/server/ranches.ts`

### Proposed changes

- Treat `app/dashboard/page.tsx` as the canonical end-user ranch/map experience.
- Change the right-side panel behavior:
  - when no lot is selected, show ranch-wide lot summary
  - when a lot is selected, show the animals for that lot in the side panel
- Extend `MapView` to support animal hover state.
  - Show at least ear tag, lot name, and current weight when available.
- Keep imports in a dedicated section below the map.
- Audit ownership data for the Gustavo/Luis issue:
  - compare `ranches.ownerUserId`
  - confirm the affected ranch documents
  - verify whether the wrong ranch is assigned or whether the wrong user is being filtered in UI

### Data/API follow-up

- `app/api/map/ranch/[id]/route.ts` already returns ranch, lots, animals, and imports, so the existing payload is close to enough.
- If hover needs richer data, extend serialized animal fields there instead of adding a second map-only endpoint.

### Acceptance criteria

- Ranch selector always drives the animals shown on the map and in the panel.
- Selected lot drives the animal list shown next to the map.
- Hovering an animal point reveals useful detail.
- Imports remain visible below the map.

## 4. Roles and Users

### Problems to solve

- New roles are required: `admin`, `institutional`, `retail`.
- Institutional users need admin-like visibility but read-only access and no posting/mutation actions.
- Admins must not be able to change their own role.
- Admins must not be able to assign themselves as a non-admin target.
- "Create user" likely no longer fits the Google-first auth flow.
- Phone approval must be fully separated from role management.

### Code areas

- `lib/db/types.ts`
- `lib/authOptions.ts`
- `lib/server/auth.ts`
- `lib/validators/users.ts`
- `app/dashboard/admin/users/page.tsx`
- `app/api/admin/users/route.ts`
- `app/api/admin/users/[id]/route.ts`
- all admin page guards under `app/dashboard/admin/*`
- all admin mutating routes under `app/api/admin/*`

### Proposed changes

- Expand `Role` to:
  - `admin`
  - `institutional`
  - `retail`
- Replace raw `isAdmin()` checks with explicit permission helpers, for example:
  - `canViewAdminScreens`
  - `canManageUsers`
  - `canMutateOperationalData`
  - `canApprovePhones`
- Recommended permission model:
  - `admin`: full access
  - `institutional`: admin visibility, read-only
  - `retail`: own ranch/dashboard flows only
- Update user/session typing and JWT/session callbacks to carry the new role values.
- Protect self-role mutation at the API layer.
  - `PATCH /api/admin/users/[id]` must reject changing the actor's own role.
- Remove self-demotion/self-reassignment loopholes from the UI as a secondary safeguard.
- Remove phone approval actions from `AdminUsersPage`.
- Either remove "Create user" completely or reframe it as a very explicit manual-provisioning tool.
  - Recommendation: remove it from the main admin UX because Google sign-in already creates users automatically.

### Migration

- Backfill existing `"user"` rows to `"retail"`.
- Keep the migration idempotent.
- Review scripts such as `scripts/makeAdmin.mjs`.

### Acceptance criteria

- Institutional users can open admin views but cannot mutate data.
- Admins cannot change their own role.
- Admins cannot use role-management UX to turn themselves into a retail user.
- Phone approval only happens through the dedicated phones flow.
- The users page becomes a management screen for existing users, not a conflicting second onboarding system.

## 5. Ranch Management

### Problem to solve

- Add an option in Ranches to remove a ranch from a user.

### Code areas

- `app/dashboard/admin/ranches/page.tsx`
- `app/api/admin/ranches/[id]/route.ts`
- `lib/server/ranches.ts`
- dependent collections in Mongo: `lots`, `animals`, `imports`, potentially `sync_jobs`

### Recommended behavior

- Default interpretation: remove the ranch from Pastora locally, not from Ixorigue remotely.
- Add an explicit destructive confirmation flow in the admin UI.

### Proposed backend behavior

- Add `DELETE /api/admin/ranches/[id]`.
- Perform a local cascade delete or an equivalent cleanup transaction for:
  - ranch document
  - related lots
  - related animals
  - related imports
  - related sync jobs if they exist for that ranch subtree
- Write an audit log entry.

### Important decision

- If preserving historical imports/audit matters, soft-delete may be better than hard-delete.
- If speed matters more and the object is purely an assignment mirror of Ixorigue, hard-delete is acceptable.

### Recommendation

- Start with hard-delete of local mirrored data only, with a clear confirmation message:
  - "This removes the ranch from Pastora and deletes its local lots/animals/imports. It does not delete the ranch in Ixorigue."

### Acceptance criteria

- Admin can remove a ranch safely from the Ranches screen.
- The action does not call remote Ixorigue delete endpoints by default.
- Local dependent data is cleaned consistently.

## 6. Ixorigue Token Admin Tool

### Problem to solve

- Admins need a UI to update/refresh Ixorigue access without manually editing env vars whenever the refresh token breaks.

### Code areas

- `lib/ixorigue/client.ts`
- new admin page under `app/dashboard/admin/*`
- new admin API route(s) under `app/api/admin/*`
- new Mongo collection for integration credentials

### Proposed architecture

- Introduce a persisted Ixorigue credential store, for example:
  - collection: `integration_credentials`
  - key: `ixorigue`
  - fields:
    - encrypted refresh token
    - optional encrypted access token cache
    - last refresh status
    - last refresh error
    - updatedAt
    - updatedByUserId
- Update `lib/ixorigue/client.ts` to resolve credentials in this order:
  1. DB-backed admin-managed credential
  2. env fallback
- Encrypt the persisted refresh token at rest.
  - Recommended: add a dedicated encryption secret in env.

### Admin UX

- Add a page such as `app/dashboard/admin/integrations/page.tsx` or `app/dashboard/admin/ixorigue/page.tsx`.
- Allow admins to:
  - paste/update refresh token
  - test token refresh
  - see last successful refresh
  - see last error message
- Do not render the full secret back to the UI after save.
- Show only masked token state and health metadata.

### Acceptance criteria

- Admin can replace the Ixorigue refresh token without changing deployment env vars.
- The app can continue using env vars as fallback until the DB-backed credential is configured.
- Secret material is not exposed in responses or UI.

## Cross-Cutting Technical Notes

### Permission refactor is the key enabler

- The largest systemic change is not the new dropdowns.
- It is replacing hardcoded `"admin"` checks with capability-based guards across pages and routes.

### Data cleanup likely needed

- The Gustavo/Luis issue is probably a data assignment issue, not a UI string issue.
- We should expect at least one Mongo verification script or manual audit before closing that item.

### Some `my/*` routes still assume one ranch

- `app/api/my/ranch/route.ts`
- `app/api/my/lots/route.ts`
- `app/api/my/imports/route.ts`
- `app/api/my/animals/route.ts`

The main dashboard already supports multiple ranches, but these routes still use `findOne({ ownerUserId })`. If multi-ranch retail users are expected, these routes should eventually take `ranchId` explicitly.

### Suggested implementation sequence

1. Role model + permission helpers + self-protection rules.
2. Remove user/phone UX conflicts.
3. Dashboard header/map panel refactor.
4. Ranch delete flow.
5. Ixorigue credential admin tool.
6. Data cleanup for ownership anomalies.

## Open Decisions To Confirm Before Coding

1. Whether `institutional` should access the same `/dashboard/admin/*` routes as admin, or a separate read-only surface.
2. Whether "sin posts" means "no create/update/delete anywhere" or only a smaller subset of posting workflows.
3. Whether ranch removal should be hard-delete or soft-delete locally.
4. Whether the map UX changes should apply only to `app/dashboard/page.tsx` or also to `app/dashboard/admin/ranches/page.tsx`.
