"""Exercise a disposable Compose installation through nginx and the real API.

Run from any directory: python deploy/sim/verify.py
Only this script's uniquely named test project and volume are removed.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]


def main():
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    project = f'arrowcast-verify-{uuid.uuid4().hex[:12]}'
    environment = {**os.environ, 'ARROWCAST_SIM_PORT': str(port)}
    token = None

    def compose(*args, check=True):
        return subprocess.run(
            ['docker', 'compose', '-p', project, *args], cwd=ROOT,
            env=environment, check=check, capture_output=True, text=True,
        )

    def api(path, body=None, expected=200):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        request = urllib.request.Request(
            f'http://127.0.0.1:{port}/api/v1/{path}', headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            value = json.load(response)
            assert response.status == expected, (path, response.status, value)
            return value

    def wait_for(predicate, label, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                print(f'PASS: {label}', flush=True)
                return
            time.sleep(0.5)
        raise AssertionError(f'Timed out: {label}')

    def control(name, value):
        compose('exec', '-T', 'pi', 'simctl', name, value)

    try:
        print('Building and starting isolated Pi simulation...', flush=True)
        compose('up', '-d', '--build', '--wait', '--wait-timeout', '120')
        api('admin/network', expected=401)
        token = api('auth/login', {'username': 'admin', 'password': 'admin'})['token']
        token = api('admin/password', {
            'currentPassword': 'admin', 'newPassword': 'simulation-test-password',
        })['token']
        wait_for(lambda: api('admin/network')['mode'] == 'hotspot', 'fresh installation starts its hotspot')
        api('admin/network', {'ssid': 'Test club', 'password': 'short'}, expected=400)
        api('admin/network', {'ssid': 'Test club', 'password': 'wrong-password'}, expected=202)
        wait_for(lambda: (
            (state := api('admin/network'))['mode'] == 'hotspot'
            and not state['busy'] and 'Could not join' in state['message']
        ), 'incorrect Wi-Fi password falls back to hotspot')
        api('admin/network', {'ssid': 'Test club', 'password': 'test-password'}, expected=202)
        wait_for(lambda: api('admin/network')['mode'] == 'wifi', 'saved Wi-Fi connects')
        wait_for(lambda: api('admin/network')['internetAvailable'], 'Wi-Fi internet becomes available')
        control('ethernet', 'on')
        wait_for(lambda: api('admin/network')['mode'] == 'ethernet', 'Ethernet takes priority')
        control('ethernet', 'off')
        wait_for(lambda: api('admin/network')['mode'] == 'wifi', 'unplugging Ethernet restores saved Wi-Fi')
        control('internet', 'off')
        wait_for(lambda: not api('admin/network')['internetAvailable'], 'offline status reaches API')
        control('internet', 'on')
        wait_for(lambda: api('admin/network')['internetAvailable'], 'internet recovers')
        control('wifi-failure', 'on')
        wait_for(lambda: api('admin/network')['mode'] == 'hotspot', 'lost Wi-Fi falls back to hotspot')
        control('wifi-failure', 'off')
        api('admin/network', {'ssid': 'Test club', 'password': 'test-password'}, expected=202)
        wait_for(lambda: api('admin/network')['mode'] == 'wifi', 'saving credentials retries failed Wi-Fi')
        with urllib.request.urlopen(f'http://127.0.0.1:{port}/admin') as response:
            assert b'<html' in response.read()
        compose('exec', '-T', 'pi', 'python3', '-c',
                "from pathlib import Path; p = Path('/opt/arrowcast/current/apps/web/dist/assets/sim-denied.txt'); "
                "p.write_text('nginx log probe'); p.chmod(0)")
        try:
            urllib.request.urlopen(f'http://127.0.0.1:{port}/assets/sim-denied.txt')
        except urllib.error.HTTPError as error:
            assert error.code == 403
        wait_for(lambda: 'Permission denied' in api('admin/logs/frontend')['text'], 'nginx error reaches frontend logs')
        assert 'listening' in api('admin/logs/backend')['text'].lower()
        assert 'SIMULATION' in api('admin/logs/updates')['text']
        for source in ['frontend', 'backend', 'updates']:
            assert 'test-password' not in api(f'admin/logs/{source}')['text']
        api('admin/logs/unknown', expected=400)
        print('PASS: real process logs, log validation and password redaction', flush=True)
        compose('restart', 'pi')
        compose('up', '-d', '--wait', '--wait-timeout', '120')
        token = api('auth/login', {'username': 'admin', 'password': 'simulation-test-password'})['token']
        wait_for(lambda: api('admin/network')['mode'] == 'wifi', 'account and saved Wi-Fi survive restart')
        print('All Pi simulation checks passed.', flush=True)
    except subprocess.CalledProcessError as error:
        print(error.stdout)
        print(error.stderr)
        print(compose('logs', '--tail', '80', check=False).stdout)
        raise
    except Exception:
        print(compose('logs', '--tail', '80', check=False).stdout)
        raise
    finally:
        compose('down', '--volumes', check=False)


if __name__ == '__main__':
    main()
