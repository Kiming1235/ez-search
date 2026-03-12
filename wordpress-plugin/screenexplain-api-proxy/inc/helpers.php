<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

defined('SCREENEXPLAIN_SETTINGS_OPTION') || define('SCREENEXPLAIN_SETTINGS_OPTION', 'screenexplain_api_proxy_settings');
defined('SCREENEXPLAIN_SECRETS_OPTION') || define('SCREENEXPLAIN_SECRETS_OPTION', 'screenexplain_api_proxy_secrets');
defined('SCREENEXPLAIN_USERS_OPTION') || define('SCREENEXPLAIN_USERS_OPTION', 'screenexplain_api_proxy_users');
defined('SCREENEXPLAIN_SESSIONS_OPTION') || define('SCREENEXPLAIN_SESSIONS_OPTION', 'screenexplain_api_proxy_sessions');
defined('SCREENEXPLAIN_AUTH_CODES_OPTION') || define('SCREENEXPLAIN_AUTH_CODES_OPTION', 'screenexplain_api_proxy_auth_codes');
defined('SCREENEXPLAIN_SETTINGS_NONCE') || define('SCREENEXPLAIN_SETTINGS_NONCE', 'screenexplain_api_proxy_save_settings');
defined('SCREENEXPLAIN_ACCESS_NONCE') || define('SCREENEXPLAIN_ACCESS_NONCE', 'screenexplain_api_proxy_access_action');
defined('SCREENEXPLAIN_REST_NAMESPACE') || define('SCREENEXPLAIN_REST_NAMESPACE', 'screenexplain/v1');
defined('SCREENEXPLAIN_PROXY_ROUTE') || define('SCREENEXPLAIN_PROXY_ROUTE', '/proxy');
defined('SCREENEXPLAIN_AUTH_REQUEST_ROUTE') || define('SCREENEXPLAIN_AUTH_REQUEST_ROUTE', '/auth/request-access');
defined('SCREENEXPLAIN_AUTH_STATUS_ROUTE') || define('SCREENEXPLAIN_AUTH_STATUS_ROUTE', '/auth/request-status');
defined('SCREENEXPLAIN_AUTH_SESSION_ROUTE') || define('SCREENEXPLAIN_AUTH_SESSION_ROUTE', '/auth/issue-session');
defined('SCREENEXPLAIN_AUTH_LOGOUT_ROUTE') || define('SCREENEXPLAIN_AUTH_LOGOUT_ROUTE', '/auth/logout');
defined('SCREENEXPLAIN_AUTH_CODE_TTL') || define('SCREENEXPLAIN_AUTH_CODE_TTL', 300);
defined('SCREENEXPLAIN_MAX_USERS') || define('SCREENEXPLAIN_MAX_USERS', 200);

function screenexplain_default_settings(): array
{
    return [
        'default_model' => 'gpt-5-mini',
        'allowed_models' => ['gpt-5-mini', 'gpt-5.1', 'gpt-4.1-mini', 'gpt-4.1', 'o4-mini'],
        'default_prompt' => '',
        'image_detail' => 'high',
        'max_upload_bytes' => 6 * 1024 * 1024,
        'max_output_tokens' => 900,
        'request_timeout_seconds' => 60,
        'rate_limit_per_minute' => 20,
        'allowed_origins' => [],
        'session_ttl_hours' => 720,
        'allowed_email_domains' => [],
        'approval_notification_email' => (string) get_option('admin_email', ''),
    ];
}

function screenexplain_get_settings(): array
{
    $defaults = screenexplain_default_settings();
    $stored = get_option(SCREENEXPLAIN_SETTINGS_OPTION, []);
    if (!is_array($stored)) {
        $stored = [];
    }

    $settings = array_merge($defaults, $stored);
    $settings['allowed_models'] = is_array($settings['allowed_models']) ? array_values(array_filter(array_map('strval', $settings['allowed_models']))) : $defaults['allowed_models'];
    $settings['allowed_origins'] = is_array($settings['allowed_origins']) ? array_values(array_filter(array_map('strval', $settings['allowed_origins']))) : [];
    $settings['allowed_email_domains'] = is_array($settings['allowed_email_domains']) ? screenexplain_normalize_domains($settings['allowed_email_domains']) : [];
    return $settings;
}

function screenexplain_sanitize_settings(array $input): array
{
    $defaults = screenexplain_default_settings();
    $allowed_models = screenexplain_split_lines($input['allowed_models'] ?? '');
    $allowed_origins = screenexplain_split_lines($input['allowed_origins'] ?? '');
    $allowed_domains = screenexplain_normalize_domains(screenexplain_split_lines($input['allowed_email_domains'] ?? ''));
    $approval_email = screenexplain_clean_string($input['approval_notification_email'] ?? '');

    return [
        'default_model' => screenexplain_clean_string($input['default_model'] ?? $defaults['default_model']) ?: $defaults['default_model'],
        'allowed_models' => $allowed_models !== [] ? $allowed_models : $defaults['allowed_models'],
        'default_prompt' => screenexplain_clean_textarea($input['default_prompt'] ?? ''),
        'image_detail' => screenexplain_clean_string($input['image_detail'] ?? $defaults['image_detail']) ?: $defaults['image_detail'],
        'max_upload_bytes' => max(1024, (int) ($input['max_upload_bytes'] ?? $defaults['max_upload_bytes'])),
        'max_output_tokens' => max(128, (int) ($input['max_output_tokens'] ?? $defaults['max_output_tokens'])),
        'request_timeout_seconds' => max(10, (int) ($input['request_timeout_seconds'] ?? $defaults['request_timeout_seconds'])),
        'rate_limit_per_minute' => max(1, (int) ($input['rate_limit_per_minute'] ?? $defaults['rate_limit_per_minute'])),
        'allowed_origins' => $allowed_origins,
        'session_ttl_hours' => max(1, (int) ($input['session_ttl_hours'] ?? $defaults['session_ttl_hours'])),
        'allowed_email_domains' => $allowed_domains,
        'approval_notification_email' => is_email($approval_email) ? $approval_email : (string) $defaults['approval_notification_email'],
    ];
}

function screenexplain_get_secret(string $name): string
{
    $stored = get_option(SCREENEXPLAIN_SECRETS_OPTION, []);
    if (!is_array($stored) || empty($stored[$name]) || !is_string($stored[$name])) {
        return '';
    }

    return screenexplain_decrypt_secret($stored[$name]);
}

function screenexplain_store_secret(string $name, string $value): void
{
    $stored = get_option(SCREENEXPLAIN_SECRETS_OPTION, []);
    if (!is_array($stored)) {
        $stored = [];
    }
    $stored[$name] = screenexplain_encrypt_secret($value);
    update_option(SCREENEXPLAIN_SECRETS_OPTION, $stored, false);
}

function screenexplain_clear_secret(string $name): void
{
    $stored = get_option(SCREENEXPLAIN_SECRETS_OPTION, []);
    if (!is_array($stored)) {
        return;
    }
    unset($stored[$name]);
    update_option(SCREENEXPLAIN_SECRETS_OPTION, $stored, false);
}

function screenexplain_encrypt_secret(string $value): string
{
    if ($value === '') {
        return '';
    }

    $iv = random_bytes(16);
    $ciphertext = openssl_encrypt($value, 'AES-256-CBC', screenexplain_secret_key_material(), OPENSSL_RAW_DATA, $iv);
    if ($ciphertext === false) {
        throw new RuntimeException('Could not encrypt secret.');
    }

    return base64_encode($iv . $ciphertext);
}

function screenexplain_decrypt_secret(string $encoded): string
{
    if ($encoded === '') {
        return '';
    }

    $raw = base64_decode($encoded, true);
    if ($raw === false || strlen($raw) <= 16) {
        return '';
    }

    $plaintext = openssl_decrypt(substr($raw, 16), 'AES-256-CBC', screenexplain_secret_key_material(), OPENSSL_RAW_DATA, substr($raw, 0, 16));
    return $plaintext === false ? '' : $plaintext;
}

function screenexplain_secret_key_material(): string
{
    $seed = (defined('AUTH_KEY') ? AUTH_KEY : '') . '|' . (defined('SECURE_AUTH_KEY') ? SECURE_AUTH_KEY : '') . '|' . wp_salt();
    return hash('sha256', $seed, true);
}

function screenexplain_hash_token(string $value): string
{
    return hash_hmac('sha256', $value, screenexplain_secret_key_material());
}

function screenexplain_get_users(): array
{
    $users = get_option(SCREENEXPLAIN_USERS_OPTION, []);
    return is_array($users) ? $users : [];
}

function screenexplain_save_users(array $users): void
{
    update_option(SCREENEXPLAIN_USERS_OPTION, $users, false);
}

function screenexplain_get_sessions(): array
{
    screenexplain_purge_expired_sessions();
    $sessions = get_option(SCREENEXPLAIN_SESSIONS_OPTION, []);
    return is_array($sessions) ? $sessions : [];
}

function screenexplain_save_sessions(array $sessions): void
{
    update_option(SCREENEXPLAIN_SESSIONS_OPTION, $sessions, false);
}

function screenexplain_get_auth_codes(): array
{
    screenexplain_purge_expired_auth_codes();
    $codes = get_option(SCREENEXPLAIN_AUTH_CODES_OPTION, []);
    return is_array($codes) ? $codes : [];
}

function screenexplain_save_auth_codes(array $codes): void
{
    update_option(SCREENEXPLAIN_AUTH_CODES_OPTION, $codes, false);
}

function screenexplain_issue_auth_code(string $sub): string
{
    $code = bin2hex(random_bytes(32));
    $codes = screenexplain_get_auth_codes();
    $codes[screenexplain_hash_token($code)] = [
        'sub' => $sub,
        'expires_at' => gmdate('c', time() + SCREENEXPLAIN_AUTH_CODE_TTL),
        'created_at' => gmdate('c'),
    ];
    screenexplain_save_auth_codes($codes);
    return $code;
}

function screenexplain_consume_auth_code(string $code): string
{
    $codes = screenexplain_get_auth_codes();
    $hash = screenexplain_hash_token($code);
    $record = $codes[$hash] ?? null;
    if (!is_array($record)) {
        throw new RuntimeException('The login code is invalid or expired.');
    }

    unset($codes[$hash]);
    screenexplain_save_auth_codes($codes);

    $expires_at = isset($record['expires_at']) ? strtotime((string) $record['expires_at']) : false;
    if ($expires_at === false || $expires_at < time()) {
        throw new RuntimeException('The login code is invalid or expired.');
    }

    return (string) $record['sub'];
}

function screenexplain_issue_session_token(string $sub): array
{
    $settings = screenexplain_get_settings();
    $ttl_seconds = max(3600, (int) $settings['session_ttl_hours'] * HOUR_IN_SECONDS);
    $token = 'ses_' . bin2hex(random_bytes(32));
    $hash = screenexplain_hash_token($token);
    $sessions = screenexplain_get_sessions();
    $sessions[$hash] = [
        'sub' => $sub,
        'created_at' => gmdate('c'),
        'expires_at' => gmdate('c', time() + $ttl_seconds),
        'last_used_at' => '',
        'last_ip' => screenexplain_get_request_ip(),
        'last_user_agent' => screenexplain_get_user_agent(),
    ];
    screenexplain_save_sessions($sessions);

    return [
        'token' => $token,
        'expires_at' => $sessions[$hash]['expires_at'],
    ];
}

function screenexplain_get_session_for_token(string $token): ?array
{
    $sessions = screenexplain_get_sessions();
    $record = $sessions[screenexplain_hash_token($token)] ?? null;
    if (!is_array($record)) {
        return null;
    }

    $expires_at = isset($record['expires_at']) ? strtotime((string) $record['expires_at']) : false;
    if ($expires_at === false || $expires_at < time()) {
        screenexplain_revoke_session_token($token);
        return null;
    }

    $sub = (string) ($record['sub'] ?? '');
    $users = screenexplain_get_users();
    $user = $users[$sub] ?? null;
    if (!is_array($user) || ($user['status'] ?? '') !== 'approved') {
        screenexplain_revoke_session_token($token);
        return null;
    }

    $sessions[screenexplain_hash_token($token)]['last_used_at'] = gmdate('c');
    $sessions[screenexplain_hash_token($token)]['last_ip'] = screenexplain_get_request_ip();
    $sessions[screenexplain_hash_token($token)]['last_user_agent'] = screenexplain_get_user_agent();
    screenexplain_save_sessions($sessions);

    return ['sub' => $sub, 'user' => $user];
}

function screenexplain_revoke_session_token(string $token): void
{
    $hash = screenexplain_hash_token($token);
    $sessions = screenexplain_get_sessions();
    if (isset($sessions[$hash])) {
        unset($sessions[$hash]);
        screenexplain_save_sessions($sessions);
    }
}

function screenexplain_revoke_sessions_for_sub(string $sub): void
{
    $sessions = screenexplain_get_sessions();
    foreach ($sessions as $hash => $session) {
        if (is_array($session) && ($session['sub'] ?? '') === $sub) {
            unset($sessions[$hash]);
        }
    }
    screenexplain_save_sessions($sessions);
}

function screenexplain_revoke_auth_codes_for_sub(string $sub): void
{
    $codes = screenexplain_get_auth_codes();
    foreach ($codes as $hash => $record) {
        if (is_array($record) && ($record['sub'] ?? '') === $sub) {
            unset($codes[$hash]);
        }
    }
    screenexplain_save_auth_codes($codes);
}

function screenexplain_purge_expired_sessions(): void
{
    $sessions = get_option(SCREENEXPLAIN_SESSIONS_OPTION, []);
    if (!is_array($sessions) || $sessions === []) {
        return;
    }

    $changed = false;
    foreach ($sessions as $hash => $session) {
        $expires_at = is_array($session) && isset($session['expires_at']) ? strtotime((string) $session['expires_at']) : false;
        if ($expires_at === false || $expires_at < time()) {
            unset($sessions[$hash]);
            $changed = true;
        }
    }

    if ($changed) {
        update_option(SCREENEXPLAIN_SESSIONS_OPTION, $sessions, false);
    }
}

function screenexplain_purge_expired_auth_codes(): void
{
    $codes = get_option(SCREENEXPLAIN_AUTH_CODES_OPTION, []);
    if (!is_array($codes) || $codes === []) {
        return;
    }

    $changed = false;
    foreach ($codes as $hash => $record) {
        $expires_at = is_array($record) && isset($record['expires_at']) ? strtotime((string) $record['expires_at']) : false;
        if ($expires_at === false || $expires_at < time()) {
            unset($codes[$hash]);
            $changed = true;
        }
    }

    if ($changed) {
        update_option(SCREENEXPLAIN_AUTH_CODES_OPTION, $codes, false);
    }
}

function screenexplain_apply_cors_headers(): void
{
    $origin = isset($_SERVER['HTTP_ORIGIN']) ? trim((string) $_SERVER['HTTP_ORIGIN']) : '';
    if ($origin === '') {
        return;
    }

    $settings = screenexplain_get_settings();
    if (!in_array($origin, (array) $settings['allowed_origins'], true)) {
        return;
    }

    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
}

function screenexplain_get_request_ip(): string
{
    $candidates = [
        $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '',
        $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '',
        $_SERVER['REMOTE_ADDR'] ?? '',
    ];

    foreach ($candidates as $candidate) {
        $value = trim((string) $candidate);
        if ($value === '') {
            continue;
        }
        if (strpos($value, ',') !== false) {
            $parts = explode(',', $value);
            $value = trim((string) $parts[0]);
        }
        if ($value !== '') {
            return $value;
        }
    }

    return 'unknown';
}

function screenexplain_get_user_agent(): string
{
    return trim((string) ($_SERVER['HTTP_USER_AGENT'] ?? ''));
}

function screenexplain_get_authorization_header(): string
{
    if (isset($_SERVER['HTTP_AUTHORIZATION'])) {
        return (string) $_SERVER['HTTP_AUTHORIZATION'];
    }
    if (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
        return (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
    }
    return '';
}

function screenexplain_get_bearer_token(): string
{
    $header = screenexplain_get_authorization_header();
    if (stripos($header, 'Bearer ') === 0) {
        return trim(substr($header, 7));
    }
    if (isset($_SERVER['HTTP_X_API_TOKEN'])) {
        return trim((string) $_SERVER['HTTP_X_API_TOKEN']);
    }
    return '';
}

function screenexplain_authorize_request(): array
{
    $token = screenexplain_get_bearer_token();
    if ($token === '') {
        return ['ok' => false];
    }

    $session = screenexplain_get_session_for_token($token);
    if ($session !== null) {
        return ['ok' => true, 'type' => 'session', 'sub' => $session['sub']];
    }

    $shared_secret = screenexplain_get_secret('shared_secret');
    if ($shared_secret !== '' && hash_equals($shared_secret, $token)) {
        return ['ok' => true, 'type' => 'legacy'];
    }

    return ['ok' => false];
}

function screenexplain_generate_access_id(): string
{
    return 'acc_' . bin2hex(random_bytes(16));
}

function screenexplain_generate_request_token(): string
{
    return 'req_' . bin2hex(random_bytes(32));
}

function screenexplain_validate_request_email(string $email, array $settings): string
{
    $normalized = screenexplain_clean_email($email);
    if ($normalized === '') {
        throw new RuntimeException('A valid email address is required.');
    }

    if ($settings['allowed_email_domains'] !== []) {
        $domain = screenexplain_email_domain($normalized);
        if ($domain === '' || !in_array($domain, (array) $settings['allowed_email_domains'], true)) {
            throw new RuntimeException('This email domain is not allowed.');
        }
    }

    return $normalized;
}

function screenexplain_match_request_identity(string $request_id, string $request_token): array
{
    if ($request_id === '' || $request_token === '') {
        throw new RuntimeException('The approval request is incomplete.');
    }

    $users = screenexplain_get_users();
    $user = $users[$request_id] ?? null;
    if (!is_array($user)) {
        throw new RuntimeException('The approval request was not found.');
    }

    $expected_hash = (string) ($user['request_token_hash'] ?? '');
    if ($expected_hash === '' || !hash_equals($expected_hash, screenexplain_hash_token($request_token))) {
        throw new RuntimeException('The approval request token is invalid.');
    }

    return $user;
}

function screenexplain_upsert_access_request(array $request_data, array $settings): array
{
    $name = screenexplain_clean_string($request_data['name'] ?? '');
    $email = screenexplain_validate_request_email((string) ($request_data['email'] ?? ''), $settings);
    $note = screenexplain_clean_textarea($request_data['note'] ?? '');
    $device_label = screenexplain_clean_string($request_data['device_label'] ?? $request_data['deviceLabel'] ?? '');
    $request_id = screenexplain_clean_string($request_data['request_id'] ?? $request_data['requestId'] ?? '');
    $request_token = trim((string) ($request_data['request_token'] ?? $request_data['requestToken'] ?? ''));
    $now = gmdate('c');

    $users = screenexplain_get_users();
    $existing = null;

    if ($request_id !== '' && $request_token !== '') {
        $existing = screenexplain_match_request_identity($request_id, $request_token);
        $request_id = (string) ($existing['sub'] ?? $request_id);
    }

    $request_token_to_return = '';
    if ($existing === null) {
        if (count($users) >= SCREENEXPLAIN_MAX_USERS) {
            throw new RuntimeException('The approval list is full. Remove older users first.');
        }

        $request_id = screenexplain_generate_access_id();
        $request_token = screenexplain_generate_request_token();
        $request_token_to_return = $request_token;
    }

    $previous = $existing ?? [];
    $status = (string) ($previous['status'] ?? 'pending');
    $users[$request_id] = [
        'sub' => $request_id,
        'email' => $email,
        'name' => $name !== '' ? $name : ($previous['name'] ?? $email),
        'picture' => '',
        'status' => $status,
        'created_at' => (string) ($previous['created_at'] ?? $now),
        'updated_at' => $now,
        'last_login_at' => (string) ($previous['last_login_at'] ?? ''),
        'last_request_at' => $now,
        'last_ip' => screenexplain_get_request_ip(),
        'last_user_agent' => screenexplain_get_user_agent(),
        'pending_notified_at' => (string) ($previous['pending_notified_at'] ?? ''),
        'request_note' => $note,
        'device_label' => $device_label,
        'request_token_hash' => (string) ($previous['request_token_hash'] ?? screenexplain_hash_token($request_token)),
        'request_token_issued_at' => (string) ($previous['request_token_issued_at'] ?? $now),
    ];

    screenexplain_save_users($users);

    if ($users[$request_id]['status'] === 'pending' && ($existing === null || empty($previous['pending_notified_at']))) {
        screenexplain_notify_pending_request($users[$request_id], $settings);
        $users = screenexplain_get_users();
        $users[$request_id]['pending_notified_at'] = gmdate('c');
        $users[$request_id]['updated_at'] = gmdate('c');
        screenexplain_save_users($users);
    }

    return [
        'user' => screenexplain_get_users()[$request_id],
        'request_token' => $request_token_to_return,
    ];
}

function screenexplain_notify_pending_request(array $user, array $settings): void
{
    $target_email = trim((string) $settings['approval_notification_email']);
    if ($target_email === '') {
        return;
    }

    $subject = 'ScreenExplain approval request';
    $message = implode("\n", [
        'A new ScreenExplain user is waiting for approval.',
        '',
        'Email: ' . (string) ($user['email'] ?? ''),
        'Name: ' . (string) ($user['name'] ?? ''),
        'Device: ' . (string) ($user['device_label'] ?? ''),
        'Note: ' . (string) ($user['request_note'] ?? ''),
        '',
        'Review: ' . admin_url('options-general.php?page=screenexplain-api-proxy'),
    ]);

    wp_mail($target_email, $subject, $message);
}

function screenexplain_touch_user_last_request(string $sub): void
{
    $users = screenexplain_get_users();
    if (!isset($users[$sub]) || !is_array($users[$sub])) {
        return;
    }

    $users[$sub]['last_request_at'] = gmdate('c');
    $users[$sub]['updated_at'] = gmdate('c');
    screenexplain_save_users($users);
}

function screenexplain_public_user_payload(array $user): array
{
    return [
        'requestId' => (string) ($user['sub'] ?? ''),
        'email' => (string) ($user['email'] ?? ''),
        'name' => (string) ($user['name'] ?? ''),
        'picture' => (string) ($user['picture'] ?? ''),
        'status' => (string) ($user['status'] ?? ''),
        'deviceLabel' => (string) ($user['device_label'] ?? ''),
        'requestNote' => (string) ($user['request_note'] ?? ''),
    ];
}

function screenexplain_parse_cache_ttl(string $cache_control): int
{
    if (preg_match('/max-age=(\d+)/i', $cache_control, $matches)) {
        return max(60, (int) $matches[1]);
    }
    return HOUR_IN_SECONDS;
}

function screenexplain_clean_string($value): string
{
    return trim(sanitize_text_field((string) $value));
}

function screenexplain_clean_textarea($value): string
{
    return trim(sanitize_textarea_field((string) $value));
}

function screenexplain_clean_email($value): string
{
    $email = sanitize_email((string) $value);
    return is_email($email) ? strtolower($email) : '';
}

function screenexplain_split_lines($value): array
{
    $text = screenexplain_clean_textarea($value);
    if ($text === '') {
        return [];
    }

    $lines = preg_split('/\r\n|\r|\n/', $text);
    if (!is_array($lines)) {
        return [];
    }

    $items = [];
    foreach ($lines as $line) {
        $clean = screenexplain_clean_string($line);
        if ($clean !== '') {
            $items[] = $clean;
        }
    }
    return array_values(array_unique($items));
}

function screenexplain_normalize_domains(array $values): array
{
    $domains = [];
    foreach ($values as $value) {
        $domain = strtolower(trim((string) $value));
        if ($domain === '') {
            continue;
        }
        $domains[] = preg_replace('/^@/', '', $domain);
    }
    return array_values(array_unique(array_filter($domains)));
}

function screenexplain_email_domain(string $email): string
{
    $parts = explode('@', strtolower($email));
    return count($parts) === 2 ? trim((string) $parts[1]) : '';
}

function screenexplain_base64url_decode(string $value): string
{
    $remainder = strlen($value) % 4;
    if ($remainder > 0) {
        $value .= str_repeat('=', 4 - $remainder);
    }

    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    return $decoded === false ? '' : $decoded;
}
