<?php
/**
 * Plugin Name: ScreenExplain API Proxy
 * Description: Receives screenshot analysis requests and proxies them to the OpenAI Responses API.
 * Version: 0.3.0
 * Author: ScreenExplain
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

require_once __DIR__ . '/inc/helpers.php';
require_once __DIR__ . '/inc/api.php';
require_once __DIR__ . '/inc/admin.php';

add_action('rest_api_init', 'screenexplain_register_rest_routes');
add_action('admin_menu', 'screenexplain_register_admin_page');
