<?php

declare(strict_types=1);

/**
 * Establish a browser session from a portal-issued bridge ticket.
 *
 * Copied into the app root (e.g. Nextcloud /var/www/html) by the bootstrap hooks.
 * The ticket is redeemed server-to-server against the portal API.
 */

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

$redeemUrl = rtrim($portalApi, '/') . '/session/bridge/redeem/' . rawurlencode($ticket);

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

// If running in Nextcloud, auto-provision and establish Nextcloud user session
if (file_exists(__DIR__ . '/lib/base.php')) {
    require_once __DIR__ . '/lib/base.php';

    if (class_exists('\\OC')) {
        $userManager = \OC::$server->getUserManager();
        $userSession = \OC::$server->getUserSession();
        $user = $userManager->get($username);

        if ($user === null) {
            $user = $userManager->createUser($username, \OC::$server->getSecureRandom()->generate(24));
            if ($user !== null && !empty($payload['name'])) {
                $user->setDisplayName($payload['name']);
            }
            if ($user !== null && !empty($payload['email'])) {
                $user->setEmailAddress($payload['email']);
            }
        }

        if ($user === null) {
            http_response_code(500);
            header('Content-Type: text/plain; charset=utf-8');
            echo 'Could not create user session';
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

        // Resolve Nextcloud landing page
        $default = '/apps/files/';
        $open = isset($_GET['open']) ? (string) $_GET['open'] : '';
        $app = isset($_GET['app']) ? (string) $_GET['app'] : '';

        if ($app !== '') {
            if (preg_match('/^[a-zA-Z0-9_-]+$/', $app)) {
                $default = '/apps/' . $app . '/';
            }
        }

        if (in_array($open, ['document', 'spreadsheet', 'presentation'], true)) {
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

            try {
                $userFolder = \OC::$server->getUserFolder($username);
                $newest = null;
                foreach ($types[$open]['mimes'] as $mime) {
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
                    $default = '/index.php/f/' . $newest->getId();
                } else {
                    // Create default file
                    $richdoc_template = \OC::$SERVERROOT . '/custom_apps/richdocuments/emptyTemplates/' . $types[$open]['template'];
                    if (!file_exists($richdoc_template)) {
                        $richdoc_template = \OC::$SERVERROOT . '/apps/richdocuments/emptyTemplates/' . $types[$open]['template'];
                    }
                    if (!file_exists($richdoc_template)) {
                        $richdoc_template = \OC::$SERVERROOT . '/core/templates/' . $types[$open]['template'];
                    }
                    if (file_exists($richdoc_template)) {
                        $content = file_get_contents($richdoc_template);
                        if ($content !== false) {
                            $name = $userFolder->getNonExistingName($types[$open]['newName']);
                            $newFile = $userFolder->newFile($name, $content);
                            $default = '/index.php/f/' . $newFile->getId();
                        }
                    }
                }
            } catch (\Throwable $e) {
                // fall back to default
            }
        }

        header('Location: ' . $default);
        exit;
    }
}

// Default fallback response
header('Content-Type: application/json; charset=utf-8');
echo json_encode($payload);
exit;
