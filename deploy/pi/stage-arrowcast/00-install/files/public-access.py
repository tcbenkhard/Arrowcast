#!/usr/bin/python3
"""Privileged public scoring broker. No shell commands or arbitrary config from the UI."""
import fcntl
from datetime import datetime, timezone
import http.server
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socketserver
import socket
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import uuid

STATE = Path('/var/lib/arrowcast-public')
CONFIG = STATE / 'config.json'
ERROR = STATE / 'error.txt'
ATTEMPT = STATE / 'attempt.json'
CHECKED = STATE / 'checked.txt'
SITE = Path('/etc/nginx/sites-available/arrowcast-public')
ENABLED = Path('/etc/nginx/sites-enabled/arrowcast-public')
WEBROOT = STATE / 'acme'
SOCKET = Path('/run/arrowcast-public/control.sock')
CERTS = Path('/etc/letsencrypt/live')
job_lock = threading.Lock()
busy = False


class DdnsError(ValueError):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        return None  # Never forward account credentials to a redirect target.


def ddns_config():
    path = STATE / 'ddns.json'
    return json.loads(path.read_text()) if path.exists() else {}


def save_ddns(value):
    atomic(STATE / 'ddns.json', json.dumps(value))


def ddns_request(path, token, method='GET', body=None):
    request = urllib.request.Request('https://dynv6.com/api/v2/' + path,
        data=json.dumps(body).encode() if body is not None else None, method=method,
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
            return json.loads(response.read(65536))
    except urllib.error.HTTPError as error:
        if error.code == 404 and method == 'GET':
            return None
        if error.code in (401, 403):
            raise DdnsError('dynv6 rejected the API token. Check its permissions.') from None
        if error.code == 422:
            raise DdnsError('dynv6 rejected the hostname or address. Check the hostname and account limits.') from None
        raise DdnsError('dynv6 request failed. Try again later.') from None
    except (OSError, ValueError):
        raise DdnsError('Could not contact dynv6. Check internet access and retry.') from None


def public_ipv4():
    try:
        with urllib.request.build_opener(NoRedirect()).open('https://api.ipify.org', timeout=15) as response:
            address = ipaddress.IPv4Address(response.read(64).decode().strip())
        if not address.is_global:
            raise ValueError()
        return str(address)
    except (OSError, ValueError):
        raise DdnsError('Could not determine the public IPv4 address. Check internet access.') from None


def update_ddns(token=None):
    """Called under operation.lock; persist the name before contacting the provider for retry safety."""
    value = ddns_config()
    previous_token = value.get('token')
    if token:
        value['token'] = token
    if not value.get('token'):
        raise DdnsError('Enter a dynv6 REST API token first.')
    # dynv6 limits the host part to 20 characters.
    # Migrate rejected names from older versions without changing registered names.
    if (not value.get('hostname') or (not value.get('ready')
            and re.fullmatch(r'arrowcast-[a-f0-9]{20}\.dynv6\.net', value['hostname']))):
        value['hostname'] = uuid.uuid4().hex[:20] + '.dynv6.net'
    save_ddns(value)
    try:
        address = public_ipv4()
        zone = ddns_request('zones/by-name/' + value['hostname'], value['token'])
        if zone is None:
            zone = ddns_request('zones', value['token'], 'POST',
                                {'name': value['hostname'], 'ipv4address': address})
        if (not isinstance(zone, dict) or zone.get('name') != value['hostname']
                or not isinstance(zone.get('id'), int) or zone['id'] <= 0):
            raise DdnsError('dynv6 returned an invalid hostname response. Try again later.')
        if zone.get('ipv4address') != address:
            ddns_request('zones/' + str(zone['id']), value['token'], 'PATCH', {'ipv4address': address})
        value.update(ready=True, address=address, lastCheckedAt=datetime.now(timezone.utc).isoformat(), message='')
        save_ddns(value)
        return value
    except Exception as error:
        # Provider bodies and request URLs must never end up in status or logs.
        if token and previous_token:
            value['token'] = previous_token  # A rejected replacement must not break existing updates.
        value['message'] = str(error) if isinstance(error, DdnsError) else 'DDNS update failed. Try again later.'
        save_ddns(value)
        raise DdnsError(value['message']) from None


def ddns_status():
    value = ddns_config()
    return {key: value[key] for key in ('hostname', 'ready', 'address', 'lastCheckedAt', 'message') if key in value}


def refresh_ddns():
    STATE.mkdir(mode=0o755, exist_ok=True)
    with (STATE / 'operation.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        value = config()
        if value['enabled'] and value.get('accessMode') == 'ddns':
            update_ddns()


def ddns_loop():
    interval = threading.Event()
    while True:
        try:
            refresh_ddns()
        except Exception:
            pass  # Safe diagnostic is persisted separately from certificate errors.
        interval.wait(300)


def hostname_addresses(domain):
    return {entry[4][0] for entry in socket.getaddrinfo(domain, 80)}


def run(args):
    try:
        return subprocess.run(args, check=True, capture_output=True, text=True, timeout=180)
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr, flush=True)
        raise


def atomic(path, text):
    temporary = path.with_suffix('.next')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(descriptor, 0o600)
    with os.fdopen(descriptor, 'w') as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def config():
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else {'enabled': False, 'domain': '', 'email': ''}


def validate(body):
    if (not isinstance(body, dict) or not {'enabled', 'domain', 'email'} <= set(body)
            or set(body) - {'enabled', 'domain', 'email', 'accessMode', 'ddnsToken', 'action'}):
        raise ValueError('Invalid settings.')
    domain = body['domain']
    email = body['email']
    if not isinstance(body['enabled'], bool) or not isinstance(domain, str) or not isinstance(email, str):
        raise ValueError('Invalid settings.')
    mode = body.get('accessMode', 'public')
    token = body.get('ddnsToken', '')
    if (mode not in ('public', 'ddns') or not isinstance(token, str) or len(token) > 512
            or (token and not re.fullmatch(r'[A-Za-z0-9._~+/=-]+', token))
            or body.get('action') not in (None, 'prepare-ddns')):
        raise ValueError('Invalid DDNS settings.')
    if body.get('action') == 'prepare-ddns':
        if mode != 'ddns':
            raise ValueError('Select DDNS access first.')
        if not token and not ddns_config().get('token'):
            raise ValueError('Enter a dynv6 REST API token first.')
        return {'action': 'prepare-ddns', 'ddnsToken': token}
    if not body['enabled']:
        return {**config(), 'enabled': False}
    domain = domain.strip().lower()
    # Only public DNS hostnames; neither IP literals nor nginx directives are accepted.
    if (len(domain) > 253 or not re.fullmatch(
            r'(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}', domain)
            or domain.endswith(('.local', '.localhost', '.internal', '.test', '.invalid', '.example'))):
        raise ValueError('Enter a public DNS hostname, for example scores.yourclub.nl.')
    if len(email) > 254 or not re.fullmatch(r'[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+', email):
        raise ValueError('Enter a valid contact email address.')
    value = {'enabled': body['enabled'], 'domain': domain, 'email': email}
    if mode == 'ddns':
        value['accessMode'] = mode
        if token:
            value['ddnsToken'] = token
    return value


def nginx(value, https):
    if not value['enabled']:
        return '# Public scoring disabled. Local administration is unchanged.\n'
    domain = value['domain']
    content = f'''server {{
    listen 80;
    listen [::]:80;
    listen 8080 default_server;
    listen [::]:8080 default_server;
    server_name {domain};
    access_log off;
    location ^~ /.well-known/acme-challenge/ {{
        root {WEBROOT};
        try_files $uri =404;
    }}
    location = /scores {{ return 302 https://{domain}/scores$is_args$args; }}
    location ^~ /scores/ {{ return 302 https://{domain}$request_uri; }}
    location ^~ /scoring/ {{ rewrite ^/scoring/(.*)$ https://{domain}/scores/$1 redirect; }}
    location / {{ return 404; }}
}}
'''
    if not https:
        return content
    return content + f'''server {{
    listen 443 ssl;
    listen [::]:443 ssl;
    listen 8443 ssl default_server;
    listen [::]:8443 ssl default_server;
    server_name {domain};
    ssl_certificate {CERTS / domain / 'fullchain.pem'};
    ssl_certificate_key {CERTS / domain / 'privkey.pem'};
    ssl_protocols TLSv1.2 TLSv1.3;
    root /opt/arrowcast/current/apps/web/dist;
    access_log off;
    error_log syslog:server=unix:/dev/log,tag=arrowcast_web warn;
    add_header Referrer-Policy no-referrer always;
    if (-f /var/lib/arrowcast-update/maintenance) {{ return 503; }}
    location = /api/scores {{
        limit_except POST {{ deny all; }}
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host {domain};
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
    }}
    # Prevent nginx from redirecting the bare API prefix to the proxied location.
    location = /api/v1/scoring {{ return 404; }}
    location ^~ /api/v1/scoring/ {{
        client_max_body_size 16k;
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host {domain};
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $remote_addr;
    }}
    location ^~ /assets/ {{ try_files $uri =404; }}
    location = /scores {{
        try_files /index.html =404;
        add_header Cache-Control no-store;
        add_header Referrer-Policy no-referrer always;
    }}
    location ^~ /scores/ {{
        try_files /index.html =404;
        add_header Cache-Control no-store;
        add_header Referrer-Policy no-referrer always;
    }}
    location ^~ /scoring/ {{ rewrite ^/scoring/(.*)$ https://{domain}/scores/$1 redirect; }}
    location / {{ return 404; }}
}}
'''


def install_site(content):
    previous = SITE.read_text() if SITE.exists() else '# Disabled\n'
    atomic(SITE, content)
    if not ENABLED.exists():
        ENABLED.symlink_to(SITE)
    try:
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
    except Exception:
        atomic(SITE, previous)
        run(['nginx', '-t'])
        run(['systemctl', 'reload', 'nginx'])
        raise


def certificate(domain):
    path = CERTS / domain / 'fullchain.pem'
    if not path.exists():
        return None
    try:
        run(['openssl', 'x509', '-in', str(path), '-checkend', '0', '-noout'])
        result = run(['openssl', 'x509', '-in', str(path), '-enddate', '-noout'])
        return result.stdout.strip().removeprefix('notAfter=')
    except subprocess.SubprocessError:
        return None


def failure(error):
    """Return useful diagnostics without returning account files or complete ACME logs."""
    output = str(error)
    if isinstance(error, subprocess.CalledProcessError):
        output = '\n'.join(part for part in (error.stdout, error.stderr) if isinstance(part, str))
    if isinstance(error, DdnsError):
        return {'code': 'ddns', 'detail': str(error)}
    if isinstance(error, subprocess.TimeoutExpired):
        code = 'timeout'
    elif re.search(r'permission denied|read-only file system', output, re.I):
        code = 'permissions'
    elif re.search(r'NXDOMAIN|DNS problem|no valid IP addresses|name or service not known', output, re.I):
        code = 'dns'
    elif re.search(r'rateLimited|too many certificates|too many failed authorizations', output, re.I):
        code = 'rate_limit'
    elif re.search(r'timeout|timed out', output, re.I):
        code = 'timeout'
    elif re.search(r'connection refused|connection reset', output, re.I):
        code = 'connection'
    elif re.search(r'Invalid response|reader size limit exceeded|unauthorized', output, re.I):
        code = 'challenge_response'
    elif isinstance(error, subprocess.CalledProcessError) and error.cmd[0] in ('nginx', 'systemctl'):
        code = 'nginx'
    else:
        code = 'configuration'
    # Certbot puts the CA's diagnostic in stdout, not just stderr.
    details = re.findall(r'^\s*Detail:\s*(.+)$', output, re.M)
    if not details:
        details = [line.strip() for line in output.splitlines()
                   if re.search(r'error|failed|denied|read-only|timeout|timed out|too many', line, re.I)]
    detail = '\n'.join(details[:3]) or (output if isinstance(error, ValueError)
                                       else 'The configuration command could not complete.')
    return {'code': code, 'detail': detail[:1500]}


def last_error():
    if not ERROR.exists():
        return None
    text = ERROR.read_text()
    try:
        value = json.loads(text)
        if isinstance(value, dict) and isinstance(value.get('code'), str) and isinstance(value.get('detail'), str):
            return value
    except ValueError:
        pass
    return {'code': 'configuration', 'detail': text[:1500]}


def snapshot():
    value = config()
    expires = certificate(value['domain']) if value['domain'] else None
    error = last_error()
    active = value['enabled'] and bool(expires)
    return {**value, 'ddns': ddns_status(), 'available': True, 'busy': busy, 'active': active,
            'expiresAt': expires, 'message': error['detail'] if error else '',
            'errorCode': error['code'] if error else None,
            'attempt': json.loads(ATTEMPT.read_text()) if error and ATTEMPT.exists() else None,
            'lastCheckedAt': CHECKED.read_text() if CHECKED.exists() else None,
            'origin': f"https://{value['domain']}" if value['enabled'] else None}


def apply(value=None, renew=False):
    """One lock shared by web requests, renewal and release reconciliation."""
    STATE.mkdir(mode=0o700, exist_ok=True)
    with (STATE / 'operation.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        old = config()
        if value is not None and value.get('action') == 'prepare-ddns':
            update_ddns(value.get('ddnsToken'))
            return
        token = value.pop('ddnsToken', None) if value is not None else None
        if value is not None:
            atomic(ATTEMPT, json.dumps(value))
            os.chmod(ATTEMPT, 0o600)
        value = value or old
        previous = SITE.read_text() if SITE.exists() else '# Disabled\n'
        try:
            WEBROOT.mkdir(parents=True, exist_ok=True, mode=0o755)
            os.chmod(WEBROOT, 0o755)  # The broker's restrictive umask must not hide ACME tokens.
            os.chmod(STATE, 0o755)  # nginx needs to traverse the ACME webroot only.
            if not value['enabled']:
                install_site(nginx(value, False))
            else:
                if value.get('accessMode') == 'ddns':
                    ddns = update_ddns(token)
                    if not renew:
                        try:
                            addresses = hostname_addresses(value['domain'])
                        except OSError:
                            addresses = set()
                        if addresses != {ddns['address']}:
                            raise ValueError('DNS problem: point the public hostname CNAME to ' + ddns['hostname']
                                             + ' and wait for DNS propagation before activating HTTPS.')
                install_site(nginx(value, bool(certificate(value['domain']))))
                if renew:
                    run(['certbot', 'renew', '--non-interactive', '--cert-name', value['domain']])
                elif not certificate(value['domain']) or value['domain'] != old['domain']:
                    run(['certbot', 'certonly', '--webroot', '-w', str(WEBROOT),
                         '--non-interactive', '--agree-tos', '--email', value['email'],
                         '--cert-name', value['domain'], '-d', value['domain']])
                elif value['email'] != old['email']:
                    run(['certbot', 'update_account', '--non-interactive', '--email', value['email']])
                if not certificate(value['domain']):
                    raise ValueError('No valid certificate was issued.')
                install_site(nginx(value, True))
            atomic(CONFIG, json.dumps(value))
            os.chmod(CONFIG, 0o600)
            ERROR.unlink(missing_ok=True)
        except Exception as error:
            report = failure(error)
            try:
                install_site(previous)
            except Exception as restore_error:
                print(f'Could not restore nginx: {restore_error}', file=sys.stderr, flush=True)
                report['code'] = 'restore'
            atomic(ERROR, json.dumps(report))
            raise
        finally:
            atomic(CHECKED, datetime.now(timezone.utc).isoformat())


def worker(value):
    global busy
    try:
        apply(value)
    except Exception:
        pass  # Persistent error is returned by /status; do not expose command output.
    finally:
        with job_lock:
            busy = False


def reconcile():
    """Restore durable device settings after a release switch or interrupted setup.

    This must work offline, including with an expired certificate. Issuance and
    renewal belong to explicit activation and the certificate timer.
    """
    STATE.mkdir(mode=0o755, exist_ok=True)
    with (STATE / 'operation.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        value = config()
        has_certificate = (CERTS / value['domain'] / 'fullchain.pem').exists()
        install_site(nginx(value, has_certificate))


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, code, value):
        data = json.dumps(value).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.respond(200, snapshot()) if self.path == '/status' else self.respond(404, {})

    def do_POST(self):
        global busy
        if self.path != '/configure':
            self.respond(404, {})
            return
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 2048:
                raise ValueError('Invalid request size.')
            value = validate(json.loads(self.rfile.read(length)))
            with job_lock:
                if busy:
                    self.respond(409, {'message': 'A configuration operation is already running.'})
                    return
                busy = True
                threading.Thread(target=worker, args=(value,), daemon=True).start()
            self.respond(202, {'message': 'Applying HTTPS configuration.'})
        except (ValueError, UnicodeError) as error:
            self.respond(400, {'message': str(error), 'errorCode': 'invalid_settings'})


def main():
    STATE.mkdir(mode=0o755, exist_ok=True)
    if '--renew' in sys.argv:
        apply(renew=True)
        return
    if '--reconcile' in sys.argv:
        reconcile()
        return
    try:
        reconcile()
    except Exception as error:
        atomic(ERROR, json.dumps(failure(error)))
    SOCKET.unlink(missing_ok=True)
    threading.Thread(target=ddns_loop, daemon=True).start()
    with socketserver.UnixStreamServer(str(SOCKET), Handler) as server:
        shutil.chown(SOCKET, group='arrowcast')
        os.chmod(SOCKET, 0o660)
        server.serve_forever()


if __name__ == '__main__':
    main()
