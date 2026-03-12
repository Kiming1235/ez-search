<?php

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

function screenexplain_register_admin_page(): void
{
    add_options_page(
        'ScreenExplain API',
        'ScreenExplain API',
        'manage_options',
        'screenexplain-api-proxy',
        'screenexplain_render_admin_page'
    );
}

function screenexplain_render_admin_page(): void
{
    if (!current_user_can('manage_options')) {
        wp_die('You do not have permission to access this page.');
    }

    screenexplain_handle_settings_submission();
    screenexplain_handle_access_action_submission();

    $settings = screenexplain_get_settings();
    $users = screenexplain_get_users();
    $endpoint = rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_PROXY_ROUTE);
    $request_access_url = rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_REQUEST_ROUTE);
    $request_status_url = rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_STATUS_ROUTE);
    $issue_session_url = rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_SESSION_ROUTE);
    $logout_url = rest_url(SCREENEXPLAIN_REST_NAMESPACE . SCREENEXPLAIN_AUTH_LOGOUT_ROUTE);
    $has_api_key = screenexplain_get_secret('openai_api_key') !== '';
    $has_shared_secret = screenexplain_get_secret('shared_secret') !== '';

    settings_errors('screenexplain-api-proxy');

    echo '<div class="wrap">';
    echo '<h1>ScreenExplain API</h1>';
    echo '<p>Configure the remote analysis endpoint and the approval-based desktop app flow.</p>';
    echo '<table class="widefat striped" style="max-width: 960px; margin: 16px 0 24px;">';
    echo '<tbody>';
    screenexplain_render_info_row('Analyze endpoint', $endpoint);
    screenexplain_render_info_row('Request access endpoint', $request_access_url);
    screenexplain_render_info_row('Request status endpoint', $request_status_url);
    screenexplain_render_info_row('Issue session endpoint', $issue_session_url);
    screenexplain_render_info_row('Logout endpoint', $logout_url);
    echo '</tbody>';
    echo '</table>';

    echo '<form method="post" style="max-width: 960px;">';
    echo '<input type="hidden" name="screenexplain_form_action" value="save_settings" />';
    wp_nonce_field(SCREENEXPLAIN_SETTINGS_NONCE);
    echo '<table class="form-table" role="presentation">';

    screenexplain_render_text_input_row(
        'OpenAI API Key',
        'openai_api_key',
        '',
        'password',
        $has_api_key ? 'Configured. Leave blank to keep the current value.' : 'Required for analysis.'
    );
    screenexplain_render_checkbox_row('Clear stored OpenAI API key', 'clear_openai_api_key');

    screenexplain_render_text_input_row(
        'Legacy Shared Secret',
        'shared_secret',
        '',
        'password',
        $has_shared_secret ? 'Configured. Optional fallback for older app builds.' : 'Optional. Use only if older clients still need a shared bearer token.'
    );
    screenexplain_render_checkbox_row('Clear legacy shared secret', 'clear_shared_secret');

    screenexplain_render_text_input_row(
        'Approval Notification Email',
        'approval_notification_email',
        (string) $settings['approval_notification_email'],
        'email',
        'Pending requests will be mailed here.'
    );
    screenexplain_render_number_input_row('Session TTL Hours', 'session_ttl_hours', (int) $settings['session_ttl_hours']);
    screenexplain_render_textarea_row(
        'Allowed Request Email Domains',
        'allowed_email_domains',
        implode("\n", (array) $settings['allowed_email_domains']),
        'Optional. One domain per line. Leave blank to allow any email address.'
    );
    screenexplain_render_text_input_row('Default Model', 'default_model', (string) $settings['default_model']);
    screenexplain_render_textarea_row(
        'Allowed Models',
        'allowed_models',
        implode("\n", (array) $settings['allowed_models']),
        'One model id per line.'
    );
    screenexplain_render_textarea_row(
        'Default Prompt',
        'default_prompt',
        (string) $settings['default_prompt'],
        'Used only when the client does not send a prompt.'
    );
    screenexplain_render_text_input_row('Image Detail', 'image_detail', (string) $settings['image_detail']);
    screenexplain_render_number_input_row('Max Upload Bytes', 'max_upload_bytes', (int) $settings['max_upload_bytes']);
    screenexplain_render_number_input_row('Max Output Tokens', 'max_output_tokens', (int) $settings['max_output_tokens']);
    screenexplain_render_number_input_row('Request Timeout Seconds', 'request_timeout_seconds', (int) $settings['request_timeout_seconds']);
    screenexplain_render_number_input_row('Rate Limit Per Minute', 'rate_limit_per_minute', (int) $settings['rate_limit_per_minute']);
    screenexplain_render_textarea_row(
        'Allowed Origins',
        'allowed_origins',
        implode("\n", (array) $settings['allowed_origins']),
        'Optional. One origin per line. Needed only when browser CORS is required.'
    );

    echo '</table>';
    submit_button('Save Settings');
    echo '</form>';

    echo '<hr style="margin: 32px 0;" />';
    echo '<h2>Access Approval</h2>';
    echo '<p>Desktop app users land in <code>pending</code> until you approve them.</p>';
    screenexplain_render_user_sections($users);
    echo '</div>';
}

function screenexplain_handle_settings_submission(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        return;
    }
    if (screenexplain_clean_string($_POST['screenexplain_form_action'] ?? '') !== 'save_settings') {
        return;
    }

    check_admin_referer(SCREENEXPLAIN_SETTINGS_NONCE);

    $settings = screenexplain_sanitize_settings($_POST);
    update_option(SCREENEXPLAIN_SETTINGS_OPTION, $settings, false);

    $openai_api_key = trim((string) ($_POST['openai_api_key'] ?? ''));
    $shared_secret = trim((string) ($_POST['shared_secret'] ?? ''));

    if (!empty($_POST['clear_openai_api_key'])) {
        screenexplain_clear_secret('openai_api_key');
    } elseif ($openai_api_key !== '') {
        screenexplain_store_secret('openai_api_key', $openai_api_key);
    }

    if (!empty($_POST['clear_shared_secret'])) {
        screenexplain_clear_secret('shared_secret');
    } elseif ($shared_secret !== '') {
        screenexplain_store_secret('shared_secret', $shared_secret);
    }

    add_settings_error('screenexplain-api-proxy', 'settings-updated', 'Settings saved.', 'updated');
}

function screenexplain_handle_access_action_submission(): void
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
        return;
    }
    if (screenexplain_clean_string($_POST['screenexplain_form_action'] ?? '') !== 'access_action') {
        return;
    }

    check_admin_referer(SCREENEXPLAIN_ACCESS_NONCE);

    $sub = screenexplain_clean_string($_POST['sub'] ?? '');
    $status = screenexplain_clean_string($_POST['target_status'] ?? '');
    if ($sub === '' || !in_array($status, ['pending', 'approved', 'blocked'], true)) {
        add_settings_error('screenexplain-api-proxy', 'access-invalid', 'The requested access action is invalid.', 'error');
        return;
    }

    $users = screenexplain_get_users();
    if (!isset($users[$sub]) || !is_array($users[$sub])) {
        add_settings_error('screenexplain-api-proxy', 'access-missing', 'The selected user account does not exist.', 'error');
        return;
    }

    $users[$sub]['status'] = $status;
    $users[$sub]['updated_at'] = gmdate('c');
    if ($status !== 'approved') {
        screenexplain_revoke_sessions_for_sub($sub);
        screenexplain_revoke_auth_codes_for_sub($sub);
    }
    screenexplain_save_users($users);

    add_settings_error('screenexplain-api-proxy', 'access-updated', 'User access updated.', 'updated');
}

function screenexplain_render_user_sections(array $users): void
{
    $sections = [
        'pending' => 'Pending Approval',
        'approved' => 'Approved Users',
        'blocked' => 'Blocked Users',
    ];

    foreach ($sections as $status => $title) {
        echo '<h3 style="margin-top: 24px;">' . esc_html($title) . '</h3>';
        $subset = screenexplain_filter_users_by_status($users, $status);
        if ($subset === []) {
            echo '<p><em>No users.</em></p>';
            continue;
        }

        echo '<table class="widefat striped" style="max-width: 1200px;">';
        echo '<thead><tr>';
        echo '<th>Requester</th>';
        echo '<th>Status</th>';
        echo '<th>Created</th>';
        echo '<th>Last Login</th>';
        echo '<th>Last Request</th>';
        echo '<th>Last IP</th>';
        echo '<th>Actions</th>';
        echo '</tr></thead><tbody>';

        foreach ($subset as $user) {
            $name = trim((string) ($user['name'] ?? ''));
            $email = trim((string) ($user['email'] ?? ''));
            $device_label = trim((string) ($user['device_label'] ?? ''));
            $request_note = trim((string) ($user['request_note'] ?? ''));
            $label = $name !== '' ? $name : $email;
            echo '<tr>';
            echo '<td><strong>' . esc_html($label) . '</strong><br /><code>' . esc_html($email) . '</code>';
            if ($device_label !== '') {
                echo '<br /><span style="color:#475569;">Device: ' . esc_html($device_label) . '</span>';
            }
            if ($request_note !== '') {
                echo '<br /><span style="color:#475569;">Note: ' . esc_html($request_note) . '</span>';
            }
            echo '</td>';
            echo '<td><code>' . esc_html((string) ($user['status'] ?? '')) . '</code></td>';
            echo '<td>' . esc_html(screenexplain_format_admin_time($user['created_at'] ?? '')) . '</td>';
            echo '<td>' . esc_html(screenexplain_format_admin_time($user['last_login_at'] ?? '')) . '</td>';
            echo '<td>' . esc_html(screenexplain_format_admin_time($user['last_request_at'] ?? '')) . '</td>';
            echo '<td><code>' . esc_html((string) ($user['last_ip'] ?? '')) . '</code></td>';
            echo '<td>';
            screenexplain_render_user_action_form((string) ($user['sub'] ?? ''), 'approved', 'Approve', $status !== 'approved');
            screenexplain_render_user_action_form((string) ($user['sub'] ?? ''), 'pending', 'Pending', $status !== 'pending');
            screenexplain_render_user_action_form((string) ($user['sub'] ?? ''), 'blocked', 'Block', $status !== 'blocked');
            echo '</td>';
            echo '</tr>';
        }

        echo '</tbody></table>';
    }
}

function screenexplain_filter_users_by_status(array $users, string $status): array
{
    $filtered = [];
    foreach ($users as $user) {
        if (is_array($user) && ($user['status'] ?? '') === $status) {
            $filtered[] = $user;
        }
    }

    usort($filtered, static function (array $left, array $right): int {
        return strcmp((string) ($right['updated_at'] ?? ''), (string) ($left['updated_at'] ?? ''));
    });

    return $filtered;
}

function screenexplain_format_admin_time($value): string
{
    $text = trim((string) $value);
    if ($text === '') {
        return '-';
    }

    $timestamp = strtotime($text);
    if ($timestamp === false) {
        return $text;
    }

    return wp_date('Y-m-d H:i', $timestamp);
}

function screenexplain_render_info_row(string $label, string $value): void
{
    echo '<tr>';
    echo '<th style="width: 220px; text-align: left;">' . esc_html($label) . '</th>';
    echo '<td><code>' . esc_html($value) . '</code></td>';
    echo '</tr>';
}

function screenexplain_render_text_input_row(string $label, string $name, string $value = '', string $type = 'text', string $description = ''): void
{
    echo '<tr>';
    echo '<th scope="row"><label for="' . esc_attr($name) . '">' . esc_html($label) . '</label></th>';
    echo '<td>';
    echo '<input name="' . esc_attr($name) . '" id="' . esc_attr($name) . '" type="' . esc_attr($type) . '" class="regular-text" value="' . esc_attr($value) . '" autocomplete="off" />';
    if ($description !== '') {
        echo '<p class="description">' . esc_html($description) . '</p>';
    }
    echo '</td>';
    echo '</tr>';
}

function screenexplain_render_number_input_row(string $label, string $name, int $value): void
{
    echo '<tr>';
    echo '<th scope="row"><label for="' . esc_attr($name) . '">' . esc_html($label) . '</label></th>';
    echo '<td><input name="' . esc_attr($name) . '" id="' . esc_attr($name) . '" type="number" class="small-text" value="' . esc_attr((string) $value) . '" /></td>';
    echo '</tr>';
}

function screenexplain_render_checkbox_row(string $label, string $name): void
{
    echo '<tr>';
    echo '<th scope="row">' . esc_html($label) . '</th>';
    echo '<td><label><input name="' . esc_attr($name) . '" type="checkbox" value="1" /> ' . esc_html($label) . '</label></td>';
    echo '</tr>';
}

function screenexplain_render_textarea_row(string $label, string $name, string $value, string $description = ''): void
{
    echo '<tr>';
    echo '<th scope="row"><label for="' . esc_attr($name) . '">' . esc_html($label) . '</label></th>';
    echo '<td>';
    echo '<textarea name="' . esc_attr($name) . '" id="' . esc_attr($name) . '" class="large-text code" rows="6">' . esc_textarea($value) . '</textarea>';
    if ($description !== '') {
        echo '<p class="description">' . esc_html($description) . '</p>';
    }
    echo '</td>';
    echo '</tr>';
}

function screenexplain_render_user_action_form(string $sub, string $target_status, string $label, bool $enabled): void
{
    if (!$enabled || $sub === '') {
        return;
    }

    echo '<form method="post" style="display:inline-block; margin: 0 6px 6px 0;">';
    echo '<input type="hidden" name="screenexplain_form_action" value="access_action" />';
    echo '<input type="hidden" name="sub" value="' . esc_attr($sub) . '" />';
    echo '<input type="hidden" name="target_status" value="' . esc_attr($target_status) . '" />';
    wp_nonce_field(SCREENEXPLAIN_ACCESS_NONCE);
    echo '<button type="submit" class="button button-secondary">' . esc_html($label) . '</button>';
    echo '</form>';
}
