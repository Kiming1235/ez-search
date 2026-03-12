<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

function screenexplain_register_rest_routes(): void
{
    register_rest_route(SCREENEXPLAIN_REST_NAMESPACE, SCREENEXPLAIN_PROXY_ROUTE, [
        [
            'methods' => WP_REST_Server::READABLE,
            'callback' => 'screenexplain_handle_health',
            'permission_callback' => '__return_true',
        ],
        [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'screenexplain_handle_analyze',
            'permission_callback' => '__return_true',
        ],
    ]);

    register_rest_route(SCREENEXPLAIN_REST_NAMESPACE, SCREENEXPLAIN_AUTH_REQUEST_ROUTE, [
        [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'screenexplain_handle_request_access',
            'permission_callback' => '__return_true',
        ],
    ]);

    register_rest_route(SCREENEXPLAIN_REST_NAMESPACE, SCREENEXPLAIN_AUTH_STATUS_ROUTE, [
        [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'screenexplain_handle_request_status',
            'permission_callback' => '__return_true',
        ],
    ]);

    register_rest_route(SCREENEXPLAIN_REST_NAMESPACE, SCREENEXPLAIN_AUTH_SESSION_ROUTE, [
        [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'screenexplain_handle_issue_session',
            'permission_callback' => '__return_true',
        ],
    ]);

    register_rest_route(SCREENEXPLAIN_REST_NAMESPACE, SCREENEXPLAIN_AUTH_LOGOUT_ROUTE, [
        [
            'methods' => WP_REST_Server::CREATABLE,
            'callback' => 'screenexplain_handle_auth_logout',
            'permission_callback' => '__return_true',
        ],
    ]);
}

function screenexplain_handle_health(WP_REST_Request $request): WP_REST_Response
{
    screenexplain_apply_cors_headers();

    $auth = screenexplain_authorize_request();
    $payload = [
        'ok' => true,
        'service' => 'screenexplain-wordpress-proxy',
        'endpoint' => rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_PROXY_ROUTE),
        'auth' => [
            'approvalRequired' => true,
            'requestAccessUrl' => rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_REQUEST_ROUTE),
            'requestStatusUrl' => rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_STATUS_ROUTE),
            'issueSessionUrl' => rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_SESSION_ROUTE),
            'logoutUrl' => rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_LOGOUT_ROUTE),
            'legacySharedSecretConfigured' => screenexplain_get_secret('shared_secret') !== '',
            'tokenType' => $auth['ok'] ? (string) ($auth['type'] ?? '') : '',
            'user' => null,
            'sessionExpiresAt' => null,
        ],
    ];

    if ($auth['ok'] && ($auth['type'] ?? '') === 'session') {
        $token = screenexplain_get_bearer_token();
        $session = screenexplain_lookup_session_record($token);
        $sub = (string) ($auth['sub'] ?? '');
        $users = screenexplain_get_users();
        $user = $users[$sub] ?? null;
        if (is_array($user)) {
            $payload['auth']['user'] = screenexplain_public_user_payload($user);
        }
        if (is_array($session) && !empty($session['expires_at'])) {
            $payload['auth']['sessionExpiresAt'] = (string) $session['expires_at'];
        }
    }

    return new WP_REST_Response($payload, 200);
}

function screenexplain_handle_analyze(WP_REST_Request $request): WP_REST_Response
{
    screenexplain_apply_cors_headers();

    $auth = screenexplain_authorize_request();
    if (!$auth['ok']) {
        return new WP_REST_Response(['error' => 'Unauthorized.'], 401);
    }

    try {
        $settings = screenexplain_get_settings();
        screenexplain_enforce_rate_limit($auth, $settings);

        $request_data = screenexplain_parse_request($request);
        $image_data_url = screenexplain_resolve_image_data_url($request, $settings, $request_data);
        $model = screenexplain_resolve_model($request_data, $settings);
        $prompt = screenexplain_resolve_prompt($request_data, $settings);
        $question = screenexplain_clean_string($request_data['question'] ?? '');
        $instruction = screenexplain_clean_string($request_data['instruction'] ?? '');

        $payload = screenexplain_build_openai_payload(
            $model,
            $prompt,
            $question,
            $instruction,
            $image_data_url,
            $settings
        );

        $response = screenexplain_call_openai($payload, $settings);
        $answer = screenexplain_extract_answer_text($response);
        if ($answer === '') {
            throw new RuntimeException('OpenAI returned an empty answer.');
        }

        if (($auth['type'] ?? '') === 'session' && !empty($auth['sub'])) {
            screenexplain_touch_user_last_request((string) $auth['sub']);
        }

        return new WP_REST_Response([
            'answer' => $answer,
            'model' => isset($response['model']) ? (string) $response['model'] : $model,
            'status' => isset($response['status']) ? (string) $response['status'] : null,
            'usage' => isset($response['usage']) && is_array($response['usage']) ? $response['usage'] : null,
        ], 200);
    } catch (Throwable $error) {
        return new WP_REST_Response(['error' => $error->getMessage()], 400);
    }
}

function screenexplain_handle_request_access(WP_REST_Request $request): WP_REST_Response
{
    screenexplain_apply_cors_headers();

    try {
        $settings = screenexplain_get_settings();
        $request_data = screenexplain_parse_request($request);
        $result = screenexplain_upsert_access_request($request_data, $settings);
        $user = is_array($result['user'] ?? null) ? $result['user'] : null;
        if ($user === null) {
            throw new RuntimeException('The approval request could not be stored.');
        }

        return new WP_REST_Response([
            'ok' => true,
            'status' => (string) ($user['status'] ?? 'pending'),
            'requestId' => (string) ($user['sub'] ?? ''),
            'requestToken' => (string) ($result['request_token'] ?? ''),
            'user' => screenexplain_public_user_payload($user),
        ], 200);
    } catch (Throwable $error) {
        return new WP_REST_Response(['error' => $error->getMessage()], 400);
    }
}

function screenexplain_handle_request_status(WP_REST_Request $request): WP_REST_Response
{
    screenexplain_apply_cors_headers();

    try {
        $request_data = screenexplain_parse_request($request);
        $request_id = screenexplain_clean_string($request_data['requestId'] ?? $request_data['request_id'] ?? '');
        $request_token = trim((string) ($request_data['requestToken'] ?? $request_data['request_token'] ?? ''));
        $user = screenexplain_match_request_identity($request_id, $request_token);

        return new WP_REST_Response([
            'ok' => true,
            'status' => (string) ($user['status'] ?? 'pending'),
            'requestId' => (string) ($user['sub'] ?? ''),
            'user' => screenexplain_public_user_payload($user),
        ], 200);
    } catch (Throwable $error) {
        return new WP_REST_Response(['error' => $error->getMessage()], 400);
    }
}

function screenexplain_handle_issue_session(WP_REST_Request $request): WP_REST_Response
{
    screenexplain_apply_cors_headers();

    try {
        $request_data = screenexplain_parse_request($request);
        $request_id = screenexplain_clean_string($request_data['requestId'] ?? $request_data['request_id'] ?? '');
        $request_token = trim((string) ($request_data['requestToken'] ?? $request_data['request_token'] ?? ''));
        $matched_user = screenexplain_match_request_identity($request_id, $request_token);
        $sub = (string) ($matched_user['sub'] ?? '');
        $users = screenexplain_get_users();
        $user = $users[$sub] ?? null;
        if (!is_array($user)) {
            throw new RuntimeException('The user account was not found.');
        }
        if (($user['status'] ?? '') !== 'approved') {
            throw new RuntimeException('This account is not approved.');
        }

        $users[$sub]['last_login_at'] = gmdate('c');
        $users[$sub]['updated_at'] = gmdate('c');
        screenexplain_save_users($users);

        $session = screenexplain_issue_session_token($sub);
        return new WP_REST_Response([
            'ok' => true,
            'token' => (string) $session['token'],
            'expiresAt' => (string) $session['expires_at'],
            'user' => screenexplain_public_user_payload($users[$sub]),
            'backendMode' => 'remote',
        ], 200);
    } catch (Throwable $error) {
        return new WP_REST_Response(['error' => $error->getMessage()], 400);
    }
}

function screenexplain_handle_auth_logout(WP_REST_Request $request): WP_REST_Response
{
    screenexplain_apply_cors_headers();

    $auth = screenexplain_authorize_request();
    if (!$auth['ok']) {
        return new WP_REST_Response(['error' => 'Unauthorized.'], 401);
    }

    if (($auth['type'] ?? '') === 'session') {
        $token = screenexplain_get_bearer_token();
        if ($token !== '') {
            screenexplain_revoke_session_token($token);
        }
    }

    return new WP_REST_Response(['ok' => true], 200);
}

function screenexplain_lookup_session_record(string $token): ?array
{
    if ($token === '') {
        return null;
    }

    $sessions = screenexplain_get_sessions();
    $record = $sessions[screenexplain_hash_token($token)] ?? null;
    return is_array($record) ? $record : null;
}

function screenexplain_parse_request(WP_REST_Request $request): array
{
    $json = $request->get_json_params();
    if (is_array($json) && $json !== []) {
        return $json;
    }

    $params = $request->get_params();
    return is_array($params) ? $params : [];
}

function screenexplain_resolve_image_data_url(WP_REST_Request $request, array $settings, array $request_data): string
{
    $files = $request->get_file_params();
    if (isset($files['image']) && is_array($files['image'])) {
        return screenexplain_uploaded_file_to_data_url($files['image'], $settings);
    }

    $image_base64 = trim((string) ($request_data['image_base64'] ?? ''));
    if ($image_base64 === '') {
        throw new RuntimeException('image or image_base64 is required.');
    }

    if (strpos($image_base64, 'data:image/') === 0) {
        return $image_base64;
    }

    return 'data:image/png;base64,' . $image_base64;
}

function screenexplain_uploaded_file_to_data_url(array $file, array $settings): string
{
    $error = isset($file['error']) ? (int) $file['error'] : UPLOAD_ERR_NO_FILE;
    if ($error !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Image upload failed.');
    }

    $tmp_name = isset($file['tmp_name']) ? (string) $file['tmp_name'] : '';
    if ($tmp_name === '' || !is_uploaded_file($tmp_name)) {
        throw new RuntimeException('Uploaded image is invalid.');
    }

    $size = isset($file['size']) ? (int) $file['size'] : 0;
    if ($size > (int) $settings['max_upload_bytes']) {
        throw new RuntimeException('Uploaded image is too large.');
    }

    $mime = screenexplain_detect_mime_type($tmp_name);
    $allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (!in_array($mime, $allowed, true)) {
        throw new RuntimeException('Unsupported image type.');
    }

    $contents = file_get_contents($tmp_name);
    if ($contents === false) {
        throw new RuntimeException('Could not read uploaded image.');
    }

    return 'data:' . $mime . ';base64,' . base64_encode($contents);
}

function screenexplain_detect_mime_type(string $path): string
{
    if (!class_exists('finfo')) {
        throw new RuntimeException('finfo extension is required.');
    }

    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = (string) $finfo->file($path);
    if ($mime === '') {
        throw new RuntimeException('Could not detect image type.');
    }

    return $mime;
}

function screenexplain_resolve_model(array $request_data, array $settings): string
{
    $requested = screenexplain_clean_string($request_data['model'] ?? '');
    if ($requested === '') {
        return (string) $settings['default_model'];
    }

    if (!in_array($requested, (array) $settings['allowed_models'], true)) {
        throw new RuntimeException('Requested model is not allowed.');
    }

    return $requested;
}

function screenexplain_resolve_prompt(array $request_data, array $settings): string
{
    $prompt = screenexplain_clean_textarea($request_data['prompt'] ?? '');
    if ($prompt !== '') {
        return $prompt;
    }

    return (string) $settings['default_prompt'];
}

function screenexplain_build_openai_payload(
    string $model,
    string $prompt,
    string $question,
    string $instruction,
    string $image_data_url,
    array $settings
): array {
    $lines = [];

    if ($prompt !== '') {
        $lines[] = $prompt;
    }
    if ($question !== '') {
        $lines[] = 'Question: ' . $question;
    }
    if ($instruction !== '') {
        $lines[] = 'Instruction: ' . $instruction;
    }
    if ($question === '' && $instruction === '') {
        $lines[] = 'Look at the image carefully and answer accurately and concisely.';
    }

    $payload = [
        'model' => $model,
        'input' => [
            [
                'role' => 'user',
                'content' => [
                    [
                        'type' => 'input_text',
                        'text' => implode("\n\n", $lines),
                    ],
                    [
                        'type' => 'input_image',
                        'image_url' => $image_data_url,
                        'detail' => (string) $settings['image_detail'],
                    ],
                ],
            ],
        ],
        'max_output_tokens' => (int) $settings['max_output_tokens'],
    ];

    if (strpos($model, 'gpt-5') === 0) {
        $payload['reasoning'] = ['effort' => 'low'];
        $payload['text'] = ['verbosity' => 'low'];
    }

    return $payload;
}

function screenexplain_call_openai(array $payload, array $settings): array
{
    $api_key = screenexplain_get_secret('openai_api_key');
    if ($api_key === '') {
        throw new RuntimeException('OpenAI API key is not configured.');
    }

    $response = wp_remote_post('https://api.openai.com/v1/responses', [
        'headers' => [
            'Authorization' => 'Bearer ' . $api_key,
            'Content-Type' => 'application/json',
        ],
        'body' => wp_json_encode($payload),
        'timeout' => (int) $settings['request_timeout_seconds'],
    ]);

    if (is_wp_error($response)) {
        throw new RuntimeException('OpenAI request failed: ' . $response->get_error_message());
    }

    $status = (int) wp_remote_retrieve_response_code($response);
    $body = wp_remote_retrieve_body($response);
    $decoded = json_decode((string) $body, true);
    if (!is_array($decoded)) {
        throw new RuntimeException('Invalid OpenAI response.');
    }

    if ($status >= 400) {
        $message = isset($decoded['error']['message']) ? (string) $decoded['error']['message'] : 'OpenAI API error (' . $status . ')';
        throw new RuntimeException($message);
    }

    return $decoded;
}

function screenexplain_extract_answer_text(array $response): string
{
    $parts = [];
    $output = isset($response['output']) && is_array($response['output']) ? $response['output'] : [];

    foreach ($output as $output_item) {
        if (!is_array($output_item)) {
            continue;
        }

        $content = isset($output_item['content']) && is_array($output_item['content']) ? $output_item['content'] : [];
        foreach ($content as $content_item) {
            if (!is_array($content_item)) {
                continue;
            }
            if (($content_item['type'] ?? '') === 'output_text' && isset($content_item['text'])) {
                $parts[] = (string) $content_item['text'];
            }
        }
    }

    if ($parts !== []) {
        return trim(implode("\n\n", $parts));
    }

    return isset($response['output_text']) ? trim((string) $response['output_text']) : '';
}

function screenexplain_enforce_rate_limit(array $auth, array $settings): void
{
    $limit = (int) $settings['rate_limit_per_minute'];
    if ($limit <= 0) {
        return;
    }

    $identity = ($auth['type'] ?? '') === 'session' && !empty($auth['sub'])
        ? 'user:' . (string) $auth['sub']
        : 'ip:' . screenexplain_get_request_ip();
    $bucket = gmdate('YmdHi');
    $key = 'screenexplain_api_rl_' . md5($identity . '|' . $bucket);
    $count = (int) get_transient($key);
    $count++;
    set_transient($key, $count, MINUTE_IN_SECONDS + 5);

    if ($count > $limit) {
        throw new RuntimeException('Too many requests.');
    }
}
