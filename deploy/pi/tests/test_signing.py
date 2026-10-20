import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'signing.py'
spec = importlib.util.spec_from_file_location('signing', SOURCE)
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


@unittest.skipUnless(shutil.which('openssl'), 'OpenSSL is required')
class SigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.private = subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA',
                                     '-pkeyopt', 'rsa_keygen_bits:2048'],
                                    check=True, capture_output=True, text=True).stdout
        cls.public = subprocess.run(['openssl', 'pkey', '-pubout'], input=cls.private,
                                   check=True, capture_output=True, text=True).stdout
        cls.other_private = subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA',
                                           '-pkeyopt', 'rsa_keygen_bits:2048'],
                                          check=True, capture_output=True, text=True).stdout

    def validate(self, public, private=None):
        environment = {'ARROWCAST_UPDATE_PUBLIC_KEY': public, 'ARROWCAST_UPDATE_PRIVATE_KEY': private or ''}
        with patch.dict(os.environ, environment):
            return signing.validate(require_private=private is not None)

    def test_multiline_pair_is_valid(self):
        public, private = self.validate(self.public, self.private)
        self.assertEqual(public.decode().replace('\r\n', '\n'), self.public)
        self.assertEqual(private.decode(), self.private)

    def test_escaped_newlines_and_windows_line_endings(self):
        for newline in ['\\n', '\\r\\n', '\r\n']:
            public, _ = self.validate(self.public.replace('\n', newline), self.private.replace('\n', newline))
            self.assertEqual(public.decode().replace('\r\n', '\n'), self.public)

    def test_filename_ssh_bare_base64_and_private_key_are_rejected_as_public(self):
        for value in ['update-public.pem', 'ssh-rsa AAAA', 'MIIBIjANBgkqh', self.private]:
            with self.assertRaisesRegex(ValueError, 'PEM public key'):
                self.validate(value)

    def test_malformed_pem_is_rejected_without_echoing_its_contents(self):
        with self.assertRaisesRegex(ValueError, 'ARROWCAST_UPDATE_PUBLIC_KEY is not a readable PEM key') as error:
            self.validate('-----BEGIN PUBLIC KEY-----\nnot-a-key\n-----END PUBLIC KEY-----')
        self.assertNotIn('not-a-key', str(error.exception))

    def test_missing_public_key_is_actionable(self):
        with self.assertRaisesRegex(ValueError, 'Paste the full PEM file contents'):
            self.validate('')

    def test_mismatched_pair_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'does not match'):
            self.validate(self.public, self.other_private)

    def test_missing_private_key_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'ARROWCAST_UPDATE_PRIVATE_KEY is missing'):
            self.validate(self.public, '')

    def test_invalid_private_key_does_not_leak_into_error(self):
        with self.assertRaisesRegex(ValueError, 'ARROWCAST_UPDATE_PRIVATE_KEY is not a readable PEM key') as error:
            self.validate(self.public, 'invalid-private-material')
        self.assertNotIn('invalid-private-material', str(error.exception))

    def test_cli_outputs_keys_that_sign_and_verify(self):
        with tempfile.TemporaryDirectory() as temporary:
            public = Path(temporary) / 'public.pem'
            private = Path(temporary) / 'private.pem'
            environment = {**os.environ,
                           'ARROWCAST_UPDATE_PUBLIC_KEY': self.public.replace('\n', '\\n'),
                           'ARROWCAST_UPDATE_PRIVATE_KEY': self.private.replace('\n', '\\n')}
            result = subprocess.run([sys.executable, '-B', str(SOURCE), '--public-output', str(public),
                                     '--private-output', str(private)], env=environment,
                                    capture_output=True, check=True)
            self.assertIn(b'configuration is valid', result.stdout)
            message = Path(temporary) / 'manifest.json'
            message.write_text('{"version":"v1.0.0"}')
            signature = Path(temporary) / 'signature'
            subprocess.run(['openssl', 'dgst', '-sha256', '-sign', str(private), '-out',
                            str(signature), str(message)], capture_output=True, check=True)
            subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(public), '-signature',
                            str(signature), str(message)], capture_output=True, check=True)
