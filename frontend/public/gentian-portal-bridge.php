<?php

declare(strict_types=1);

/**
 * Establish a Nextcloud browser session from a portal-issued bridge ticket.
 *
 * Copied into /var/www/html by the Nextcloud profile bootstrap hook. The ticket
 * is redeemed server-to-server against the portal API so embedded iframe login
 * does not depend on browser form POST + CSRF cookies (blocked as third-party).
 */

/**
 * Resolve the post-login landing URL from an optional ?open=<type> intent.
 *
 * The portal "Document / Spreadsheet / Presentation" tiles pass ?open=<type>.
 * Collabora (richdocuments) exposes no URL that creates a blank file, so we open
 * the user's most recently edited file of that type; when they have none yet we
 * seed a blank one from the app's bundled empty template. Any other value (and the
 * plain Files tile) lands on the file browser.
 */
function gentian_bridge_landing(string $username): string
{
    $default = '/apps/files/';
    $open = isset($_GET['open']) ? (string) $_GET['open'] : '';
    $app = isset($_GET['app']) ? (string) $_GET['app'] : '';

    if ($app !== '') {
        if (preg_match('/^[a-zA-Z0-9_-]+$/', $app)) {
            return '/apps/' . $app . '/';
        }
    }

    $types = [
        'document' => [
            'template' => 'template.odt',
            'newName' => 'New Document.odt',
            'mimes' => [
                'application/vnd.oasis.opendocument.text',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ],
        ],
        'spreadsheet' => [
            'template' => 'template.ods',
            'newName' => 'New Spreadsheet.ods',
            'mimes' => [
                'application/vnd.oasis.opendocument.spreadsheet',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            ],
        ],
        'presentation' => [
            'template' => 'template.odp',
            'newName' => 'New Presentation.odp',
            'mimes' => [
                'application/vnd.oasis.opendocument.presentation',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            ],
        ],
    ];

    if (!isset($types[$open])) {
        return $default;
    }

    $fileId = gentian_office_file_id($username, $types[$open]);
    if ($fileId === null) {
        return $default;
    }

    // richdocuments' document#index lacks NoCSRFRequired, so a top-level browser
    // redirect there fails Nextcloud's CSRF check ("Access forbidden"). The
    // private-link route (files.View.showFile) is CSRF-exempt and opens the file
    // with its default editor (Collabora for office files) — this is exactly what
    // richdocuments' own editOnline handler redirects to.
    return '/index.php/f/' . $fileId;
}

/**
 * fileId of the user's newest file matching $type['mimes'], creating a blank one
 * from the richdocuments empty template when none exists. Null on any failure so
 * the caller falls back to the Files app.
 */
function gentian_office_file_id(string $username, array $type): ?int
{
    try {
        $userFolder = \OC::$server->getUserFolder($username);
    } catch (\Throwable $e) {
        return null;
    }

    $newest = null;
    foreach ($type['mimes'] as $mime) {
        foreach ($userFolder->searchByMime($mime) as $node) {
            if (!$node instanceof \OCP\Files\File) {
                continue;
            }
            if ($newest === null || $node->getMTime() > $newest->getMTime()) {
                $newest = $node;
            }
        }
    }
    if ($newest !== null) {
        return $newest->getId();
    }

    try {
        $appPath = \OC::$server->getAppManager()->getAppPath('richdocuments');
    } catch (\Throwable $e) {
        return null;
    }
    $templatePath = $appPath . '/emptyTemplates/' . $type['template'];
    if (!is_file($templatePath)) {
        return null;
    }
    $content = file_get_contents($templatePath);
    if ($content === false) {
        return null;
    }

    try {
        $name = $userFolder->getNonExistingName($type['newName']);
        return $userFolder->newFile($name, $content)->getId();
    } catch (\Throwable $e) {
        return null;
    }
}

$ticket = isset($_GET['t']) ? (string) $_GET['t'] : '';
if ($ticket === '') {
    http_response_code(400);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Missing bridge ticket';
    exit;
}

$portalApi = getenv('GENTIAN_PORTAL_BRIDGE_API');
if (!is_string($portalApi) || $portalApi === '') {
    $portalApi = 'http://gentian-portal-gentian-portal-api.platform-kernel.svc.cluster.local:8000/api/v1';
}

$redeemUrl = rtrim($portalApi, '/') . '/session/nextcloud-bridge/redeem/' . rawurlencode($ticket);

$context = stream_context_create([
    'http' => [
        'method' => 'GET',
        'timeout' => 10,
        'ignore_errors' => true,
        'header' => "Accept: application/json\r\n",
    ],
]);

$responseBody = @file_get_contents($redeemUrl, false, $context);
if ($responseBody === false) {
    http_response_code(502);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Could not reach portal bridge';
    exit;
}

$payload = json_decode($responseBody, true);
if (!is_array($payload) || empty($payload['username']) || !is_string($payload['username'])) {
    http_response_code(401);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Invalid or expired bridge ticket';
    exit;
}

$username = $payload['username'];

require_once __DIR__ . '/lib/base.php';

$userManager = \OC::$server->getUserManager();
$userSession = \OC::$server->getUserSession();
$user = $userManager->get($username);

if ($user === null) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Nextcloud account not found';
    exit;
}

$userSession->setUser($user);

$dataDir = (string) \OC::$server->getConfig()->getSystemValue('datadirectory', \OC::$SERVERROOT . '/data');
$userDir = rtrim($dataDir, '/') . '/' . $username;
if (!is_dir($userDir . '/files')) {
    mkdir($userDir . '/files', 0770, true);
    mkdir($userDir . '/cache', 0770, true);
}
\OC::$server->getUserFolder($username);

$userSession->createSessionToken(
    \OC::$server->getRequest(),
    $user->getUID(),
    $user->getUID()
);

header('Location: ' . gentian_bridge_landing($username));
exit;
