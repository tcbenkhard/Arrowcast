import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'stage-arrowcast/00-install/files/public-access.py'
spec = importlib.util.spec_from_file_location('public_access', SOURCE)
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)
VALUE = {'enabled': True, 'domain': 'scores.club.nl', 'email': 'admin@club.nl'}


class PublicAccessTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        for name, path in {'STATE': root, 'CONFIG': root / 'config.json', 'ERROR': root / 'error',
                           'CHECKED': root / 'checked', 'ATTEMPT': root / 'attempt.json', 'SITE': root / 'site', 'ENABLED': root / 'enabled',
                           'WEBROOT': root / 'acme', 'CERTS': root / 'certs'}.items():
            override = patch.object(public, name, path)
            override.start()
            self.addCleanup(override.stop)

    def test_rejects_injection_local_names_ip_literals_and_arbitrary_options(self):
        for domain in ['arrowcast.local', 'localhost', '127.0.0.1', '../etc/passwd',
                       'scores.club.nl; return 200;', 'scores.club.nl\nserver {}', 'https://scores.club.nl',
                       '-option.nl', 'a..nl', '*.club.nl']:
            with self.subTest(domain=domain), self.assertRaises(ValueError):
                public.validate({**VALUE, 'domain': domain})
        for value in [{**VALUE, 'command': 'reboot'}, {**VALUE, 'enabled': 'yes'},
                      {**VALUE, 'email': 'a@b.nl\ncommand'}]:
            with self.assertRaises(ValueError):
                public.validate(value)
        self.assertEqual(public.validate({**VALUE, 'domain': 'Scores.Club.NL'}), VALUE)
        self.assertFalse(public.validate({'enabled': False, 'domain': '', 'email': ''})['enabled'])

    def test_failed_issuance_restores_previous_configuration_and_settings(self):
        old = {**VALUE, 'enabled': False}
        public.CONFIG.write_text(json.dumps(old))
        public.SITE.write_text('# previous config')
        calls = []

        def install(content):
            calls.append(content)
            public.SITE.write_text(content)

        with patch.object(public, 'install_site', side_effect=install), \
                patch.object(public, 'certificate', return_value=None), \
                patch.object(public, 'run', side_effect=subprocess.CalledProcessError(1, 'certbot')):
            with self.assertRaises(subprocess.CalledProcessError):
                public.apply(VALUE)
        self.assertEqual(public.config(), old)
        self.assertEqual(public.SITE.read_text(), '# previous config')
        self.assertIn('listen 8080', calls[0])
        self.assertNotIn('listen 8443', calls[0])
        self.assertTrue(public.ERROR.exists())
        self.assertTrue(public.CHECKED.exists())
        self.assertEqual(public.WEBROOT.stat().st_mode & 0o777, 0o755)
        self.assertEqual(public.snapshot()['attempt'], VALUE)

    def test_certbot_stdout_contains_the_actionable_failure_without_returning_full_logs(self):
        error = subprocess.CalledProcessError(1, ['certbot', 'certonly'],
            output='Account registered.\n  Type: unauthorized\n  Detail: 217.104.2.19: Error reading HTTP response body: reader size limit exceeded\n\nHint: Check the webroot.\n',
            stderr='Saving debug log to /var/log/letsencrypt/letsencrypt.log\nSome challenges have failed.')
        report = public.failure(error)
        self.assertEqual(report['code'], 'challenge_response')
        self.assertIn('reader size limit exceeded', report['detail'])
        self.assertNotIn('Account registered', report['detail'])
        self.assertNotIn('Saving debug log', report['detail'])
        public.ERROR.write_text(json.dumps(report))
        public.ATTEMPT.write_text(json.dumps(VALUE))
        state = public.snapshot()
        self.assertEqual(state['errorCode'], 'challenge_response')
        self.assertEqual(state['attempt']['domain'], VALUE['domain'])

    def test_failure_categories_distinguish_router_dns_permissions_and_rate_limits(self):
        for output, code in [('DNS problem: NXDOMAIN', 'dns'), ('Timeout during connect', 'timeout'),
                             ('Connection refused', 'connection'), ('Read-only file system', 'permissions'),
                             ('too many failed authorizations', 'rate_limit')]:
            with self.subTest(code=code):
                self.assertEqual(public.failure(subprocess.CalledProcessError(1, ['certbot'], output=output))['code'], code)

    def test_activation_and_renewal_reload_tls_and_preserve_device_settings(self):
        commands = []
        issued = False

        def run(args):
            nonlocal issued
            commands.append(args)
            issued = True

        with patch.object(public, 'install_site') as install, \
                patch.object(public, 'certificate', side_effect=lambda _domain: 'expiry' if issued else None), \
                patch.object(public, 'run', side_effect=run):
            public.apply(VALUE)
            self.assertEqual(public.config(), VALUE)
            self.assertIn('listen 8443 ssl', install.call_args.args[0])
            self.assertIn('--webroot', commands[0])
            public.apply(renew=True)
            self.assertEqual(commands[-1], ['certbot', 'renew', '--non-interactive', '--cert-name', VALUE['domain']])
            self.assertEqual(public.snapshot()['origin'], 'https://scores.club.nl')
            public.ERROR.write_text('Renewal failed')
            self.assertTrue(public.snapshot()['active'])  # Existing valid TLS still works.
            public.apply({**VALUE, 'enabled': False})
            self.assertNotIn('listen', install.call_args.args[0])
            self.assertIsNone(public.snapshot()['origin'])

    def test_nginx_validation_failure_restores_file(self):
        public.SITE.write_text('# old')
        public.ENABLED.touch()  # Do not require Windows symlink permissions for this unit test.
        with patch.object(public, 'run', side_effect=[subprocess.CalledProcessError(1, 'nginx'), None, None]):
            with self.assertRaises(subprocess.CalledProcessError):
                public.install_site('invalid config')
        self.assertEqual(public.SITE.read_text(), '# old')

    def test_reconciliation_restores_saved_settings_without_requesting_a_certificate(self):
        public.CONFIG.write_text(json.dumps(VALUE))
        cert = public.CERTS / VALUE['domain'] / 'fullchain.pem'
        cert.parent.mkdir(parents=True)
        cert.touch()  # Reconciliation also preserves an expired certificate for offline updates.
        with patch.object(public, 'install_site') as install, patch.object(public, 'run') as run:
            public.reconcile()
            self.assertIn('listen 8443 ssl', install.call_args.args[0])
            self.assertIn('server_name scores.club.nl', install.call_args.args[0])
            run.assert_not_called()
        self.assertEqual(public.config(), VALUE)

    def test_ddns_registration_is_durable_and_does_not_enable_public_access(self):
        def request(path, token, method='GET', body=None):
            self.assertEqual(token, 'secret-token')
            if method == 'GET':
                return None
            self.assertEqual(method, 'POST')
            return {'id': 42, 'name': body['name'], 'ipv4address': '8.8.8.8'}

        with patch.object(public, 'ddns_request', side_effect=request), \
                patch.object(public, 'public_ipv4', return_value='8.8.8.8'), \
                patch.object(public, 'install_site') as install:
            public.apply(public.validate({**VALUE, 'enabled': False, 'accessMode': 'ddns',
                                          'action': 'prepare-ddns', 'ddnsToken': 'secret-token'}))
            install.assert_not_called()
        saved = public.ddns_config()
        self.assertRegex(saved['hostname'], r'^[a-f0-9]{20}\.dynv6\.net$')
        self.assertFalse(public.config()['enabled'])
        self.assertTrue(public.snapshot()['ddns']['ready'])
        self.assertNotIn('secret-token', json.dumps(public.snapshot()))
        self.assertEqual((public.STATE / 'ddns.json').stat().st_mode & 0o777, 0o600)
        self.assertFalse(public.ATTEMPT.exists())

    def test_ddns_migrates_only_unregistered_oversized_names(self):
        old_name = 'arrowcast-' + 'a' * 20 + '.dynv6.net'
        for ready in (False, True):
            public.save_ddns({'hostname': old_name, 'token': 'secret-token', 'ready': ready})

            def request(path, token, method='GET', body=None):
                return {'id': 42, 'name': public.ddns_config()['hostname'], 'ipv4address': '8.8.8.8'}

            with patch.object(public, 'public_ipv4', return_value='8.8.8.8'), \
                    patch.object(public, 'ddns_request', side_effect=request):
                result = public.update_ddns()
            if ready:
                self.assertEqual(result['hostname'], old_name)
            else:
                self.assertRegex(result['hostname'], r'^[a-f0-9]{20}\.dynv6\.net$')

    def test_ddns_retry_reuses_hostname_and_updates_only_a_changed_address(self):
        public.save_ddns({'hostname': 'arrowcast-test.dynv6.net', 'token': 'secret-token'})
        zone = {'id': 42, 'name': 'arrowcast-test.dynv6.net', 'ipv4address': '8.8.8.8'}
        with patch.object(public, 'public_ipv4', return_value='8.8.8.8'), \
                patch.object(public, 'ddns_request', return_value=zone) as request:
            public.update_ddns()
            self.assertEqual(request.call_count, 1)
            public.update_ddns()
            self.assertEqual(request.call_count, 2)
        with patch.object(public, 'public_ipv4', return_value='1.1.1.1'), \
                patch.object(public, 'ddns_request', return_value=zone) as request:
            public.update_ddns()
            request.assert_called_with('zones/42', 'secret-token', 'PATCH', {'ipv4address': '1.1.1.1'})
        self.assertEqual(public.ddns_status()['address'], '1.1.1.1')

    def test_ddns_failure_preserves_hostname_and_hides_provider_secrets(self):
        with patch.object(public, 'public_ipv4', return_value='8.8.8.8'), \
                patch.object(public, 'ddns_request', side_effect=RuntimeError('secret-token')):
            with self.assertRaises(public.DdnsError):
                public.update_ddns('secret-token')
        hostname = public.ddns_config()['hostname']
        self.assertNotIn('secret-token', json.dumps(public.snapshot()))
        with patch.object(public, 'public_ipv4', return_value='8.8.8.8'), \
                patch.object(public, 'ddns_request', return_value={'id': 42, 'name': hostname,
                                                                  'ipv4address': '8.8.8.8'}):
            public.update_ddns()
        self.assertEqual(public.ddns_config()['hostname'], hostname)
        self.assertEqual(public.ddns_status()['message'], '')

    def test_ddns_checks_dns_before_certificate_and_never_persists_token_in_attempt(self):
        old = {**VALUE, 'enabled': False}
        public.CONFIG.write_text(json.dumps(old))
        with patch.object(public, 'update_ddns', return_value={'hostname': 'a.dynv6.net', 'address': '8.8.8.8'}), \
                patch.object(public.socket, 'getaddrinfo', side_effect=OSError('not resolved')), \
                patch.object(public, 'install_site'), patch.object(public, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'CNAME'):
                public.apply({**VALUE, 'accessMode': 'ddns', 'ddnsToken': 'secret-token'})
            run.assert_not_called()
        self.assertEqual(public.config(), old)
        self.assertNotIn('secret-token', public.ATTEMPT.read_text())
        self.assertNotIn('secret-token', json.dumps(public.snapshot()))
        self.assertEqual(public.snapshot()['errorCode'], 'dns')

    def test_ddns_refresh_only_runs_for_enabled_ddns_mode_and_keeps_tls_settings(self):
        for value in [VALUE, {**VALUE, 'accessMode': 'ddns', 'enabled': False},
                      {**VALUE, 'accessMode': 'ddns'}]:
            public.CONFIG.write_text(json.dumps(value))
            with patch.object(public, 'update_ddns') as update, patch.object(public, 'install_site') as install:
                public.refresh_ddns()
                self.assertEqual(update.call_count, int(value['enabled'] and value.get('accessMode') == 'ddns'))
                install.assert_not_called()
            self.assertEqual(public.config(), value)

    def test_ddns_activation_and_renewal_keep_mode_and_reuse_stored_credentials(self):
        value = {**VALUE, 'accessMode': 'ddns'}
        with patch.object(public, 'update_ddns', return_value={'hostname': 'a.dynv6.net', 'address': '8.8.8.8'}) as update, \
                patch.object(public.socket, 'getaddrinfo', return_value=[(None, None, None, None, ('8.8.8.8', 80))]), \
                patch.object(public, 'certificate', return_value='expiry'), \
                patch.object(public, 'install_site'), patch.object(public, 'run') as run:
            public.apply({**value, 'ddnsToken': 'new-token'})
            update.assert_called_with('new-token')
            self.assertEqual(public.config(), value)
            self.assertNotIn('new-token', json.dumps(public.snapshot()))
            public.apply(renew=True)
            update.assert_called_with(None)
            run.assert_called_with(['certbot', 'renew', '--non-interactive', '--cert-name', VALUE['domain']])

    def test_rejected_replacement_token_keeps_previous_credentials(self):
        public.save_ddns({'hostname': 'a.dynv6.net', 'token': 'working-token', 'ready': True})
        with patch.object(public, 'public_ipv4', return_value='8.8.8.8'), \
                patch.object(public, 'ddns_request', side_effect=public.DdnsError('Token rejected.')):
            with self.assertRaises(public.DdnsError):
                public.update_ddns('invalid-token')
        self.assertEqual(public.ddns_config()['token'], 'working-token')
        self.assertNotIn('working-token', json.dumps(public.snapshot()))

    def test_ddns_http_errors_are_safe_and_credentials_cannot_follow_redirects(self):
        for status in [301, 401, 403, 422, 429, 500]:
            with patch.object(public.urllib.request.OpenerDirector, 'open',
                    side_effect=urllib.error.HTTPError('https://secret-token', status, 'secret-token', {}, None)):
                with self.assertRaises(public.DdnsError) as raised:
                    public.ddns_request('zones', 'secret-token', 'POST', {'name': 'a.dynv6.net'})
                self.assertNotIn('secret-token', str(raised.exception))
        self.assertIsNone(public.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://example.com'))

    def test_ddns_rejects_bad_tokens_and_actions(self):
        for extra in [{'ddnsToken': 'token\nheader'}, {'ddnsToken': 'x' * 513},
                      {'accessMode': 'unknown'}, {'action': 'arbitrary'},
                      {'action': 'prepare-ddns', 'accessMode': 'ddns'}]:
            with self.assertRaises(ValueError):
                public.validate({**VALUE, **extra})


if __name__ == '__main__':
    unittest.main()
