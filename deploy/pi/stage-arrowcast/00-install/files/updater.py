#!/usr/bin/python3
"""Root-owned update broker. Only signed packages from the configured repo are accepted."""
import hashlib
from contextlib import closing, contextmanager
import http.server
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import socketserver
import socket
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import urllib.error
import urllib.request

STATE = Path('/var/lib/arrowcast-update')
APP = Path('/opt/arrowcast')
DATABASE = Path('/var/lib/arrowcast/arrowcast.sqlite')
CONFIG = Path('/etc/arrowcast/update.json')
KEY = Path('/etc/arrowcast/update-public.pem')
SOCKET = Path('/run/arrowcast-update/control.sock')
NETWORK_SOCKET = '/run/arrowcast-network/control.sock'
OFFLINE_MESSAGE = 'Arrowcast must be connected to the internet to check for updates.'
MAX_PACKAGE = 512 * 1024 * 1024
lock = threading.Lock()
status = {'status': 'checking', 'availableVersion': None, 'message': 'Checking for updates…'}
candidate = None
last_check = 0.0
busy = False


@contextmanager
def database_connection(*args, **kwargs):
    # sqlite3's own context manager commits but does not close the connection.
    with closing(sqlite3.connect(*args, **kwargs)) as connection:
        with connection:
            yield connection


def atomic_json(path, value):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as stream:
        json.dump(value, stream)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    sync_dir(path.parent)


def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def version(value):
    match = re.fullmatch(r'v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', value)
    if not match:
        raise ValueError('Updates require stable semantic versions, such as v1.2.0.')
    return tuple(map(int, match.groups()))


def current_version():
    return (APP / 'current/VERSION').read_text().strip()


def download(url, limit, *, accept='application/octet-stream'):
    if not url.startswith('https://'):
        raise ValueError('Update downloads must use HTTPS.')
    req = urllib.request.Request(url, headers={'User-Agent': 'Arrowcast-Updater', 'Accept': accept})
    with urllib.request.urlopen(req, timeout=60) as response:
        if not response.url.startswith('https://'):
            raise ValueError('Insecure update redirect.')
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError('Update download exceeds its size limit.')
    return data


def release_candidate():
    config = json.loads(CONFIG.read_text())
    repo = config['repository']
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid release repository.')
    try:
        release = json.loads(download(f'https://api.github.com/repos/{repo}/releases/latest', 1024 * 1024,
                                      accept='application/vnd.github+json'))
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
        error.close()
        # GitHub also returns 404 when there is no published stable release.
        # Confirm repository access so a bad configuration still fails visibly.
        download(f'https://api.github.com/repos/{repo}', 1024 * 1024,
                 accept='application/vnd.github+json')
        return None
    if release.get('draft') or release.get('prerelease'):
        raise ValueError('Release is not a published stable release.')
    tag = release['tag_name']
    installed = current_version()
    installed_version = (0, 0, 0) if re.fullmatch(r'[0-9a-f]{12,40}', installed) else version(installed)
    if version(tag) <= installed_version:
        return None
    base = f'https://github.com/{repo}/releases/download/{tag}/'
    raw = download(base + 'update.json', 16384)
    signature = download(base + 'update.sig', 4096)
    with tempfile.TemporaryDirectory(dir=STATE) as temporary:
        manifest_path = Path(temporary) / 'manifest'
        signature_path = Path(temporary) / 'signature'
        manifest_path.write_bytes(raw)
        signature_path.write_bytes(signature)
        subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(KEY), '-signature',
                        str(signature_path), str(manifest_path)], check=True, capture_output=True)
    manifest = json.loads(raw)
    if (manifest.get('format') != 1 or manifest.get('platform') != 'raspios-trixie-arm64'
            or manifest.get('version') != tag or manifest.get('file') != 'arrowcast-update.tar.xz'
            or type(manifest.get('size')) is not int or not 0 < manifest['size'] <= MAX_PACKAGE
            or not re.fullmatch(r'[0-9a-f]{64}', manifest.get('sha256', ''))):
        raise ValueError('Incompatible or invalid update manifest.')
    manifest['url'] = base + manifest['file']
    return manifest


def set_status(kind, message, available=None):
    global status
    with lock:
        status = {'status': kind, 'message': message, 'availableVersion': available}
        atomic_json(STATE / 'status.json', status)


def updates_connected():
    # Both features use the network broker's cached, verified internet reachability.
    connection = http.client.HTTPConnection('localhost', timeout=2)
    try:
        connection.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.sock.settimeout(2)
        connection.sock.connect(NETWORK_SOCKET)
        connection.request('GET', '/status')
        response = connection.getresponse()
        if response.status != 200:
            return False
        state = json.loads(response.read(65536))
        return isinstance(state, dict) and state.get('internetAvailable') is True
    except (OSError, ValueError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def check():
    global candidate, last_check, busy
    try:
        if not updates_connected():
            candidate = None
            set_status('offline', OFFLINE_MESSAGE)
            return
        if not KEY.exists() or not CONFIG.exists():
            set_status('disabled', 'Updates are not configured for this image.')
            return
        candidate = release_candidate()
        set_status('available' if candidate else 'idle', '', candidate['version'] if candidate else None)
    except Exception as error:
        set_status('failed', f'Could not check for updates: {error}')
    finally:
        with lock:
            last_check = time.monotonic()
            busy = False


def switch_release(target):
    temporary = APP / 'current.next'
    temporary.unlink(missing_ok=True)
    temporary.symlink_to(target)
    os.replace(temporary, APP / 'current')
    sync_dir(APP)


def recover():
    journal_path = STATE / 'transaction.json'
    if journal_path.exists():
        journal = json.loads(journal_path.read_text())
        if journal['phase'] != 'committed':
            switch_release(journal['previous'])
            if journal['phase'] == 'backed-up':
                # Service is stopped, so no SQLite connection retains the old WAL.
                for suffix in ('-wal', '-shm'):
                    Path(str(DATABASE) + suffix).unlink(missing_ok=True)
                shutil.copyfile(STATE / 'backup.sqlite', DATABASE)
                shutil.chown(DATABASE, user='arrowcast', group='arrowcast')
                os.chmod(DATABASE, 0o640)
                with DATABASE.open('rb') as stream:
                    os.fsync(stream.fileno())
                sync_dir(DATABASE.parent)
            set_status('failed', 'Update failed or was interrupted. The previous version was restored.')
        journal_path.unlink()
        sync_dir(STATE)
    (STATE / 'maintenance').unlink(missing_ok=True)


def active_competition():
    with database_connection(f'file:{DATABASE}?mode=ro', uri=True) as db:
        return db.execute("SELECT 1 FROM competitions WHERE status = 'Active' LIMIT 1").fetchone() is not None


def safe_extract(archive, destination):
    with tarfile.open(archive, 'r:xz') as bundle:
        members = bundle.getmembers()
        if len(members) > 100000 or sum(entry.size for entry in members) > 2 * 1024**3:
            raise ValueError('Unpacked update exceeds its size limit.')
        bundle.extractall(destination, members=members, filter='data')
    for directory, directories, files in os.walk(destination):
        for name in directories + files:
            path = Path(directory) / name
            if not path.is_symlink():
                os.chown(path, 0, 0)
                os.chmod(path, 0o755 if path.is_dir() or path.stat().st_mode & 0o111 else 0o644)


def install():
    global busy, candidate
    stopped = False
    transaction = False
    try:
        if not updates_connected():
            candidate = None
            set_status('offline', OFFLINE_MESSAGE)
            return
        set_status('installing', 'Downloading and verifying update…')
        # Recheck the signed manifest at installation time; never accept a browser URL.
        manifest = release_candidate()
        if not manifest:
            raise ValueError('No newer update is available.')
        if active_competition():
            raise ValueError('Close active competitions before updating.')
        database_size = sum(path.stat().st_size for path in DATABASE.parent.glob('arrowcast.sqlite*'))
        if shutil.disk_usage(APP).free < 3 * 1024**3 + database_size * 2:
            raise ValueError('Insufficient space: allow 3 GiB plus twice the database size.')
        with tempfile.TemporaryDirectory(dir=STATE) as temporary:
            archive = Path(temporary) / 'update.tar.xz'
            data = download(manifest['url'], manifest['size'])
            if len(data) != manifest['size'] or hashlib.sha256(data).hexdigest() != manifest['sha256']:
                raise ValueError('Update checksum does not match.')
            archive.write_bytes(data)
            del data
            destination = APP / 'releases' / ('update-' + manifest['version'])
            if destination.exists():
                if destination.resolve() == (APP / 'current').resolve():
                    raise ValueError('Release is already installed.')
                shutil.rmtree(destination)
            destination.mkdir(mode=0o755)
            safe_extract(archive, destination)
            if (destination / 'VERSION').read_text().strip() != manifest['version']:
                raise ValueError('Package version does not match the manifest.')
            # Flush staged files before recording a switch that must survive power loss.
            os.sync()
            journal = {'previous': str((APP / 'current').resolve()), 'phase': 'prepared'}
            atomic_json(STATE / 'transaction.json', journal)
            transaction = True
            (STATE / 'maintenance').touch(mode=0o644)
            set_status('installing', 'Backing up data and restarting Arrowcast…')
            subprocess.run(['systemctl', 'stop', 'arrowcast.service'], check=True, timeout=90)
            stopped = True
            # Check again after writes have drained, avoiding a race with competition activation.
            if active_competition():
                raise ValueError('Close active competitions before updating.')
            backup_path = STATE / 'backup.sqlite'
            backup_path.touch(mode=0o600, exist_ok=True)
            os.chmod(backup_path, 0o600)
            with database_connection(DATABASE) as source, database_connection(backup_path) as backup:
                source.backup(backup)
            with (STATE / 'backup.sqlite').open('rb') as stream:
                os.fsync(stream.fileno())
            journal['phase'] = 'backed-up'
            atomic_json(STATE / 'transaction.json', journal)
            switch_release(destination)
            subprocess.run(['systemctl', 'reset-failed', 'arrowcast.service'], check=False)
            subprocess.run(['systemctl', 'start', 'arrowcast.service'], check=True, timeout=90)
            for _ in range(60):
                try:
                    with urllib.request.urlopen('http://127.0.0.1:3000/api/v1/health', timeout=2) as response:
                        if json.load(response).get('version') == manifest['version']:
                            break
                except Exception:
                    pass
                time.sleep(1)
            else:
                raise ValueError('Updated application failed its health check.')
            journal['phase'] = 'committed'
            atomic_json(STATE / 'transaction.json', journal)
            recover()
            transaction = False
            candidate = None
            set_status('idle', 'Update installed successfully.')
    except Exception as error:
        try:
            if transaction:
                subprocess.run(['systemctl', 'stop', 'arrowcast.service'], check=True, timeout=90)
                stopped = True
                recover()
            if stopped:
                subprocess.run(['systemctl', 'reset-failed', 'arrowcast.service'], check=False)
                subprocess.run(['systemctl', 'start', 'arrowcast.service'], check=True, timeout=90)
        except Exception as recovery_error:
            # Keep maintenance/journal intact and let systemd retry recovery before
            # accepting another request. Never continue after an incomplete rollback.
            set_status('failed', f'Recovery failed; retrying on service restart: {recovery_error}')
            os._exit(1)
        set_status('failed', f'Update failed: {error}', candidate['version'] if candidate else None)
    finally:
        with lock:
            busy = False


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        global busy, candidate, status
        if self.path != '/status':
            self.send_error(404)
            return
        connected = updates_connected()
        with lock:
            if not connected and not (busy and status['status'] == 'installing'):
                candidate = None
                status = {'status': 'offline', 'message': OFFLINE_MESSAGE, 'availableVersion': None}
            elif connected and not busy and (status['status'] == 'offline' or time.monotonic() - last_check > 900):
                busy = True
                status = {'status': 'checking', 'message': 'Checking for updates…', 'availableVersion': None}
                threading.Thread(target=check, daemon=True).start()
            result = {**status, 'currentVersion': current_version()}
        self.respond(200, result)

    def do_POST(self):
        global busy
        if self.path != '/install':
            self.send_error(404)
            return
        if not updates_connected():
            self.respond(503, {'status': 'offline', 'message': OFFLINE_MESSAGE,
                               'availableVersion': None, 'currentVersion': current_version()})
            return
        with lock:
            if busy or status['status'] not in ('available', 'failed') or candidate is None:
                result = {'message': 'No update is available, or another operation is in progress.'}
                code = 409
            else:
                busy = True
                status.update(status='installing', message='Starting update…')
                result = {**status, 'currentVersion': current_version()}
                code = 202
                threading.Thread(target=install, daemon=True).start()
        self.respond(code, result)

    def respond(self, code, value):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *_args):
        pass


def main():
    STATE.mkdir(mode=0o755, exist_ok=True)
    if '--recover' in sys.argv:
        # A broker restart can happen while the application is still running.
        restart = (STATE / 'transaction.json').exists() and subprocess.run(
            ['systemctl', 'is-active', '--quiet', 'arrowcast.service'], check=False).returncode == 0
        if restart:
            subprocess.run(['systemctl', 'stop', 'arrowcast.service'], check=True, timeout=90)
        recover()
        if restart:
            subprocess.run(['systemctl', '--no-block', 'start', 'arrowcast.service'], check=True)
        return
    global status, busy
    if (STATE / 'status.json').exists():
        status = json.loads((STATE / 'status.json').read_text())
    SOCKET.unlink(missing_ok=True)
    with socketserver.UnixStreamServer(str(SOCKET), Handler) as server:
        shutil.chown(SOCKET, group='arrowcast')
        os.chmod(SOCKET, 0o660)
        busy = True
        threading.Thread(target=check, daemon=True).start()
        server.serve_forever()


if __name__ == '__main__':
    main()
