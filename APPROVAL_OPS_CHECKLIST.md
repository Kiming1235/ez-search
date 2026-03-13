# Server Approval Ops Checklist

This project is locked to the server approval flow.

- Do not move back to a shared password model.
- Do not embed OpenAI keys or admin secrets in the EXE.
- Do not add Google or SNS login until backend OAuth support exists.

## Fixed direction

- Distribution model: EXE installer
- Access model: approval request -> admin approval -> session issue
- Admin surface: WordPress admin only
- Public landing page: not required
- Production API endpoint: `https://daehancargocrane.com/wp-json/screenexplain/v1/proxy`
- `api.daehancargocrane.com`: do not use yet because SSL is still missing

## Before distribution

1. Confirm the latest installer works on a clean Windows machine.
2. Confirm the app shows the connection summary card and opens the connection modal.
3. Confirm a user can submit an approval request with email only.
4. Confirm WordPress admin shows the request under `Pending Approval`.
5. Confirm approval changes the user to `Approved Users`.
6. Confirm the app can issue a session after approval by using the status check path.
7. Confirm image analysis works with the issued session.
8. Confirm `blocked` immediately stops further API use.

## First real-user test

1. Send the installer to one real user only.
2. Ask that user to submit an approval request from the target device.
3. Approve the request in WordPress admin.
4. Have the user press the status check action once.
5. Verify the user can analyze a screenshot without entering any manual API key.
6. Move the same user to `blocked` and verify access is revoked.
7. Restore the user to `approved` only if the revocation test passed.

## Admin operating rules

1. Treat `pending` as untrusted until manually reviewed.
2. Approve only known recipients.
3. Block unknown or duplicate requests.
4. If a user device changes, treat it as a new approval event.
5. Revoke access by moving the user to `blocked`.
6. Keep WordPress admin access limited to you.

## Security guardrails

1. Keep OpenAI keys on the server only.
2. Keep session tokens short-lived and server-revocable.
3. Keep request tokens and session tokens out of git and release assets.
4. Remove the legacy shared-token path when old clients are no longer needed.
5. Do not switch to the `api` subdomain until HTTPS is valid.

## Next build changes to prefer

1. Remove or hide the legacy shared-token field once migration is complete.
2. Add optional invite code support if tighter recipient control is needed.
3. Add session expiry and silent re-issue checks if long-term external use grows.
