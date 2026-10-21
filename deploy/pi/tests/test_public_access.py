import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
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


if __name__ == '__main__':
    unittest.main()
