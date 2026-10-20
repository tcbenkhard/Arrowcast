import importlib.util
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'stage-arrowcast/00-install/files/updater.py'
spec = importlib.util.spec_from_file_location('updater', SOURCE)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        for name, path in {'APP': root / 'app', 'STATE': root / 'state',
                           'DATABASE': root / 'data/arrowcast.sqlite',
                           'CONFIG': root / 'config.json', 'KEY': root / 'public.pem'}.items():
            override = patch.object(updater, name, path)
            override.start()
            self.addCleanup(override.stop)
        updater.STATE.mkdir()
        updater.DATABASE.parent.mkdir()
        factory = updater.APP / 'releases/factory'
        factory.mkdir(parents=True)
        (factory / 'VERSION').write_text('v1.0.0')
        # Windows developer checkouts may not permit symlinks. Core checks still run there.
        self.symlinks = True
        try:
            (updater.APP / 'current').symlink_to(factory, target_is_directory=True)
        except OSError:
            self.symlinks = False
        for target, value in [('sync_dir', lambda _path: None)]:
            override = patch.object(updater, target, value)
            override.start()
            self.addCleanup(override.stop)
        with updater.database_connection(updater.DATABASE) as db:
            db.execute('CREATE TABLE competitions (status TEXT)')
            db.execute("INSERT INTO competitions VALUES ('Closed')")
        updater.candidate = None
        updater.busy = False

    def require_symlinks(self):
        if not self.symlinks:
            self.skipTest('Filesystem does not permit symlinks; Linux CI runs this test.')

    def test_semantic_versions(self):
        self.assertGreater(updater.version('v1.10.0'), updater.version('v1.9.0'))
        for value in ['v1.0.0-beta', 'v1.0.0/../../', '1.02.3', 'latest']:
            with self.assertRaises(ValueError):
                updater.version(value)

    def test_archive_rejects_path_traversal_and_external_symlink(self):
        for name, link in [('../../outside', None), ('escape', '/etc/passwd')]:
            archive = updater.STATE / 'malicious.tar.xz'
            with tarfile.open(archive, 'w:xz') as bundle:
                member = tarfile.TarInfo(name)
                if link:
                    member.type = tarfile.SYMTYPE
                    member.linkname = link
                bundle.addfile(member)
            with self.assertRaises(tarfile.FilterError):
                updater.safe_extract(archive, updater.STATE / 'extract')
        self.assertFalse((updater.STATE.parent / 'outside').exists())

    def test_active_competition_prevents_installation(self):
        with updater.database_connection(updater.DATABASE) as db:
            db.execute("UPDATE competitions SET status = 'Active'")
        with patch.object(updater, 'release_candidate', return_value={'version': 'v1.1.0'}), \
                patch.object(updater.subprocess, 'run') as commands:
            updater.install()
        self.assertEqual(updater.status['status'], 'failed')
        self.assertIn('active competitions', updater.status['message'])
        commands.assert_not_called()

    def test_checksum_failure_does_not_stop_application(self):
        manifest = {'version': 'v1.1.0', 'url': 'https://example.test/update', 'size': 3, 'sha256': '0' * 64}
        with patch.object(updater, 'release_candidate', return_value=manifest), \
                patch.object(updater.shutil, 'disk_usage', return_value=type('Space', (), {'free': 10 * 1024**3})()), \
                patch.object(updater, 'download', return_value=b'bad'), \
                patch.object(updater.subprocess, 'run') as commands:
            updater.install()
        self.assertIn('checksum', updater.status['message'])
        commands.assert_not_called()
        self.assertFalse((updater.STATE / 'maintenance').exists())

    def test_recovery_restores_database_and_previous_code(self):
        self.require_symlinks()
        previous = (updater.APP / 'current').resolve()
        with updater.database_connection(updater.DATABASE) as source, updater.database_connection(updater.STATE / 'backup.sqlite') as backup:
            source.backup(backup)
        with updater.database_connection(updater.DATABASE) as db:
            db.execute('CREATE TABLE new_schema (id INTEGER)')
        updated = updater.APP / 'releases/update-v1.1.0'
        updated.mkdir()
        updater.switch_release(updated)
        updater.atomic_json(updater.STATE / 'transaction.json', {'phase': 'backed-up', 'previous': str(previous)})
        (updater.STATE / 'maintenance').touch()
        with patch.object(updater.shutil, 'chown'):
            updater.recover()
        self.assertEqual((updater.APP / 'current').resolve(), previous)
        with updater.database_connection(updater.DATABASE) as db:
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name = 'new_schema'").fetchone())
        self.assertFalse((updater.STATE / 'maintenance').exists())
        self.assertFalse((updater.STATE / 'transaction.json').exists())

    def test_prepared_recovery_preserves_database_and_committed_recovery_preserves_release(self):
        self.require_symlinks()
        previous = (updater.APP / 'current').resolve()
        updater.atomic_json(updater.STATE / 'transaction.json', {'phase': 'prepared', 'previous': str(previous)})
        updater.recover()  # No backup exists yet: must not try to restore one.
        self.assertFalse(updater.active_competition())
        updated = updater.APP / 'releases/update-v1.1.0'
        updated.mkdir()
        updater.switch_release(updated)
        updater.atomic_json(updater.STATE / 'transaction.json', {'phase': 'committed', 'previous': str(previous)})
        updater.recover()
        self.assertEqual((updater.APP / 'current').resolve(), updated)

    def test_real_signature_and_manifest_compatibility(self):
        self.require_symlinks()
        openssl = shutil.which('openssl')
        if not openssl:
            self.skipTest('OpenSSL required; installed in Linux CI.')
        private = updater.STATE / 'private.pem'
        subprocess.run([openssl, 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048',
                        '-out', str(private)], check=True, capture_output=True)
        subprocess.run([openssl, 'pkey', '-in', str(private), '-pubout', '-out', str(updater.KEY)],
                       check=True, capture_output=True)
        updater.CONFIG.write_text(json.dumps({'repository': 'owner/arrowcast'}))
        manifest = {'format': 1, 'version': 'v1.1.0', 'platform': 'raspios-trixie-arm64',
                    'file': 'arrowcast-update.tar.xz', 'size': 100, 'sha256': 'a' * 64}

        def check_manifest(value, corrupt=False):
            raw = json.dumps(value).encode()
            path = updater.STATE / 'manifest'
            path.write_bytes(raw)
            signature = subprocess.run([openssl, 'dgst', '-sha256', '-sign', str(private), str(path)],
                                       check=True, capture_output=True).stdout
            responses = [json.dumps({'tag_name': 'v1.1.0'}).encode(), raw + (b' ' if corrupt else b''), signature]
            with patch.object(updater, 'download', side_effect=responses):
                return updater.release_candidate()

        self.assertEqual(check_manifest(manifest)['version'], 'v1.1.0')
        with self.assertRaises(subprocess.CalledProcessError):
            check_manifest(manifest, corrupt=True)
        with self.assertRaises(ValueError):
            check_manifest({**manifest, 'platform': 'unsupported'})

    def exercise_install(self, healthy):
        self.require_symlinks()
        archive = updater.STATE / 'package.tar.xz'
        with tarfile.open(archive, 'w:xz') as bundle:
            member = tarfile.TarInfo('VERSION')
            contents = b'v1.1.0\n'
            member.size = len(contents)
            bundle.addfile(member, io.BytesIO(contents))
        contents = archive.read_bytes()
        manifest = {'version': 'v1.1.0', 'size': len(contents),
                    'sha256': hashlib.sha256(contents).hexdigest(), 'url': 'https://example.test/package'}

        def systemctl(command, **_kwargs):
            if command[1] == 'start' and updater.current_version() == 'v1.1.0':
                # Simulate a startup migration, which must be undone if health fails.
                with updater.database_connection(updater.DATABASE) as db:
                    db.execute('CREATE TABLE new_schema (id INTEGER)')

        with patch.object(updater, 'release_candidate', return_value=manifest), \
                patch.object(updater.shutil, 'disk_usage', return_value=type('Space', (), {'free': 10 * 1024**3})()), \
                patch.object(updater.shutil, 'chown'), \
                patch.object(updater.os, 'chown', create=True), \
                patch.object(updater, 'download', return_value=contents), \
                patch.object(updater.os, 'sync', create=True), \
                patch.object(updater.subprocess, 'run', side_effect=systemctl), \
                patch.object(updater.time, 'sleep'), \
                patch.object(updater.urllib.request, 'urlopen',
                             side_effect=lambda *_args, **_kwargs: io.BytesIO(json.dumps(
                                 {'version': 'v1.1.0' if healthy else 'wrong-version'}).encode())):
            updater.install()
        self.assertEqual(updater.current_version(), 'v1.1.0' if healthy else 'v1.0.0')
        self.assertEqual(updater.status['status'], 'idle' if healthy else 'failed')
        self.assertFalse((updater.STATE / 'maintenance').exists())
        self.assertFalse((updater.STATE / 'transaction.json').exists())
        with updater.database_connection(updater.DATABASE) as db:
            migration = db.execute("SELECT name FROM sqlite_master WHERE name = 'new_schema'").fetchone()
            self.assertEqual(migration is not None, healthy)

    def test_successful_install_keeps_new_code_and_migrations(self):
        self.exercise_install(healthy=True)

    def test_unhealthy_install_restores_old_code_and_database(self):
        self.exercise_install(healthy=False)

    def test_duplicate_install_requests_are_rejected(self):
        self.require_symlinks()
        updater.status = {'status': 'available', 'message': '', 'availableVersion': 'v1.1.0'}
        updater.candidate = {'version': 'v1.1.0'}
        handler = object.__new__(updater.Handler)
        handler.path = '/install'
        responses = []
        handler.respond = lambda code, value: responses.append(code)
        with patch.object(updater.threading.Thread, 'start'):
            handler.do_POST()
            handler.do_POST()
        self.assertEqual(responses, [202, 409])


if __name__ == '__main__':
    unittest.main()
