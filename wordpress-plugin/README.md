# ScreenExplain WordPress Backend

This folder contains the WordPress backend used by the desktop app in remote approval mode.

## What it does

- accepts desktop approval requests
- stores users as `pending`, `approved`, or `blocked`
- issues per-user session tokens after approval
- receives screenshot analysis requests
- calls the OpenAI Responses API from the server side

## Plugin source

- `screenexplain-api-proxy/screenexplain-api-proxy.php`
- `screenexplain-api-proxy/inc/helpers.php`
- `screenexplain-api-proxy/inc/api.php`
- `screenexplain-api-proxy/inc/admin.php`

## Main endpoints

After activation, the backend exposes:

- `GET /wp-json/screenexplain/v1/proxy`
- `POST /wp-json/screenexplain/v1/proxy`
- `POST /wp-json/screenexplain/v1/auth/request-access`
- `POST /wp-json/screenexplain/v1/auth/request-status`
- `POST /wp-json/screenexplain/v1/auth/issue-session`
- `POST /wp-json/screenexplain/v1/auth/logout`

## Admin setup

After activation:

1. go to `Settings -> ScreenExplain API`
2. set `OpenAI API Key`
3. optionally set `Legacy Shared Secret` only if older desktop builds still need it
4. review approval requests in the same admin page

## Approval flow

1. a desktop user sends `request-access`
2. WordPress stores the user as `pending`
3. the admin changes the user to `approved` or `blocked`
4. the desktop app calls `issue-session`
5. the app uses the returned session token for analysis requests

## Notes

- secrets are stored encrypted with WordPress salts
- the OpenAI API key stays on the server
- the desktop app should use session tokens instead of a shared secret for new deployments
- `Legacy Shared Secret` exists only as a compatibility fallback
