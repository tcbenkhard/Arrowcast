#!/usr/bin/python3
"""Root network broker; the web process can only read status or submit Wi-Fi credentials."""
import configparser
import http.server
import json
import os
from pathlib import Path
import queue
import re
import socketserver
import subprocess
import threading
import time
import urllib.request

SOCKET = Path('/run/arrowcast-network/control.sock')
NET = Path('/sys/class/net')
PROFILE = Path('/etc/NetworkManager/system-connections/arrowcast-client.nmconnection')
HOTSPOT = 'e9f2d6bd-75ab-4b2f-9a48-1f67de407cd9'
CLIENT = '477d791f-e43a-4e94-9fe3-4e6d9f058a64'
CONNECTIVITY_URL = 'https://www.gstatic.com/generate_204'


def internet_available():
    try:
        request = urllib.request.Request(CONNECTIVITY_URL, headers={'User-Agent': 'Arrowcast-Connectivity/1.0'})
        with urllib.request.urlopen(request, timeout=5) as response:
            # TLS validation and an exact response reject captive portals and local-only networks.
            return response.status == 204 and response.url == CONNECTIVITY_URL
    except (OSError, ValueError):
        return False


def nm(*args):
    return subprocess.run(['nmcli', '--wait', '20', *args], check=True,
                          capture_output=True, text=True, timeout=25,
                          env={**os.environ, 'LC_ALL': 'C'}).stdout.strip()


def dhcp(enabled):
    subprocess.run(['systemctl', 'start' if enabled else 'stop', 'arrowcast-dhcp.service'],
                   check=True, capture_output=True, timeout=15)


def ethernet_connected():
    # Carrier, rather than an assigned IP, implements cable priority even while DHCP negotiates.
    for device in NET.iterdir():
        try:
            if (device / 'type').read_text().strip() == '1' and not (device / 'wireless').exists() \
                    and device.name != 'lo' and (device / 'carrier').read_text().strip() == '1':
                return True
        except OSError:
            continue
    return False


def validate(body):
    if not isinstance(body, dict) or set(body) != {'ssid', 'password'}:
        raise ValueError('Supply a network name and password.')
    ssid, password = body['ssid'], body['password']
    if not isinstance(ssid, str) or not 1 <= len(ssid.encode('utf-8')) <= 32 \
            or any(ord(c) < 32 or ord(c) == 127 for c in ssid):
        raise ValueError('The network name must be 1–32 UTF-8 bytes without control characters.')
    if not isinstance(password, str) or any(ord(c) < 32 or ord(c) == 127 for c in password) \
            or (password and not (8 <= len(password) <= 63 or re.fullmatch('[0-9a-fA-F]{64}', password))):
        raise ValueError('Use an 8–63 character Wi-Fi password, 64 hexadecimal digits, or leave it empty for an open network.')
    return ssid, password


def profile_content(ssid, password):
    # Keyfile escaping keeps secrets out of process arguments and supports punctuation in passwords.
    escaped = password.replace('\\', '\\\\').replace(' ', '\\s')
    content = f'''[connection]
id=Arrowcast saved Wi-Fi
uuid={CLIENT}
type=wifi
interface-name=wlan0
autoconnect=false
[wifi]
mode=infrastructure
ssid={';'.join(str(b) for b in ssid.encode('utf-8'))};
hidden=true
'''
    if password:
        content += f'[wifi-security]\nkey-mgmt=wpa-psk\npsk={escaped}\n'
    content += '[ipv4]\nmethod=auto\n[ipv6]\nmethod=auto\n'
    return content


def save_profile(ssid, password):
    temporary = PROFILE.with_suffix('.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(profile_content(ssid, password))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, PROFILE)
    nm('connection', 'load', str(PROFILE))


def saved_ssid():
    if not PROFILE.exists():
        return None
    config = configparser.ConfigParser(interpolation=None)
    config.read(PROFILE)
    value = config['wifi']['ssid']
    if re.fullmatch(r'(?:[0-9]{1,3};)+', value):
        return bytes(int(b) for b in value.rstrip(';').split(';')).decode('utf-8')
    # NetworkManager can rewrite the legacy byte array as a GLib keyfile string.
    return re.sub(r'\\([sntr\\;])', lambda match: {
        's': ' ', 'n': '\n', 't': '\t', 'r': '\r', '\\': '\\', ';': ';',
    }[match[1]], value)


class Network:
    def __init__(self):
        self.lock = threading.Lock()
        self.jobs = queue.Queue(maxsize=1)
        self.state = dict(mode='starting', busy=False, ssid=None, address=None, message='')
        self.state['internetAvailable'] = False
        self.connectivity_changed = threading.Event()
        self.network_revision = 0
        self.next_attempt = 0

    def snapshot(self):
        with self.lock:
            return dict(self.state)

    def update(self, **values):
        with self.lock:
            if 'mode' in values and values['mode'] != self.state['mode']:
                self.network_revision += 1
                self.state['internetAvailable'] = False
                self.connectivity_changed.set()
            self.state.update(values)

    def check_connectivity(self):
        with self.lock:
            revision = self.network_revision
        available = internet_available()
        with self.lock:
            if revision == self.network_revision:
                self.state['internetAvailable'] = available

    def monitor_connectivity(self):
        while True:
            self.connectivity_changed.clear()
            self.check_connectivity()
            self.connectivity_changed.wait(15)

    def submit(self, body):
        credentials = validate(body)
        with self.lock:
            if self.state['busy']:
                return 409, dict(message='A Wi-Fi connection is already being configured.')
            self.state.update(busy=True, message='Saving Wi-Fi settings. Reconnect to the chosen network if the connection drops.')
            self.jobs.put_nowait(credentials)
            return 202, dict(self.state)

    def hotspot(self):
        self.update(mode='starting', address=None)
        nm('connection', 'up', 'uuid', HOTSPOT)
        dhcp(True)

    def reconcile(self):
        self.update(ssid=saved_ssid())
        if ethernet_connected():
            dhcp(False)
            if nm('radio', 'wifi') != 'disabled':
                nm('radio', 'wifi', 'off')
            self.update(mode='ethernet', address=None)
            self.next_attempt = 0
            return
        if nm('radio', 'wifi') != 'enabled':
            subprocess.run(['rfkill', 'unblock', 'wifi'], check=True, capture_output=True, timeout=5)
            nm('radio', 'wifi', 'on')
        active = nm('-g', 'GENERAL.CON-UUID', 'device', 'show', 'wlan0')
        if active != CLIENT and PROFILE.exists() and time.monotonic() >= self.next_attempt:
            dhcp(False)
            try:
                nm('connection', 'up', 'uuid', CLIENT)
                active = CLIENT
            except (subprocess.SubprocessError, OSError):
                self.next_attempt = float('inf')
                self.update(message='Could not join saved Wi-Fi. The ArrowCast hotspot is available. Check the network name/password and save again to retry.')
                active = ''
        # Recheck after connection attempts so plugging in a cable always wins.
        if ethernet_connected():
            dhcp(False)
            nm('radio', 'wifi', 'off')
            self.update(mode='ethernet', address=None)
            return
        if active not in (CLIENT, HOTSPOT):
            self.hotspot()
            active = HOTSPOT
        elif active == HOTSPOT:
            dhcp(True)
        else:
            dhcp(False)
        address = nm('-g', 'IP4.ADDRESS', 'device', 'show', 'wlan0').splitlines()
        self.update(mode='wifi' if active == CLIENT else 'hotspot',
                    address=address[0].split('/')[0] if address else None)

    def run(self):
        while True:
            job = None
            try:
                try:
                    job = self.jobs.get_nowait()
                except queue.Empty:
                    pass
                if job:
                    # Give the HTTP response time to reach a browser on the hotspot before switching.
                    time.sleep(1)
                    save_profile(*job)
                    self.next_attempt = 0
                    # Force reactivation when changing credentials on an already connected profile.
                    if not ethernet_connected():
                        dhcp(False)
                        nm('radio', 'wifi', 'off')
                    self.update(message='Wi-Fi settings saved. Ethernet takes priority whenever a cable is connected.')
                self.reconcile()
            except (OSError, ValueError, KeyError, configparser.Error, subprocess.SubprocessError):
                self.update(message='Network configuration failed. Check the connection and try again.')
            finally:
                if job:
                    self.update(busy=False)
                    self.jobs.task_done()
            time.sleep(2)


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log credentials or requests.

    def respond(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.respond(200, self.server.network.snapshot()) if self.path == '/status' else self.respond(404, {})

    def do_POST(self):
        if self.path != '/connect':
            self.respond(404, {})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2048:
                raise ValueError('Invalid request size.')
            code, body = self.server.network.submit(json.loads(self.rfile.read(length)))
            self.respond(code, body)
        except (ValueError, UnicodeError) as error:
            self.respond(400, dict(message=str(error)))


def main():
    import grp

    class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
        daemon_threads = True

    SOCKET.unlink(missing_ok=True)
    network = Network()
    with Server(str(SOCKET), Handler) as server:
        server.network = network
        os.chown(SOCKET, 0, grp.getgrnam('arrowcast').gr_gid)
        os.chmod(SOCKET, 0o660)
        threading.Thread(target=network.run, daemon=True).start()
        threading.Thread(target=network.monitor_connectivity, daemon=True).start()
        server.serve_forever()


if __name__ == '__main__':
    main()
