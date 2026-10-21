#!/usr/bin/python3
"""Privileged public scoring broker. No shell commands or arbitrary config from the UI."""
import fcntl
from datetime import datetime, timezone
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import socketserver
import subprocess
import sys
import threading

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


def run(args):
    try:
        return subprocess.run(args, check=True, capture_output=True, text=True, timeout=180)
    except subprocess.CalledProcessError as error:
        print(error.stderr, file=sys.stderr, flush=True)
        raise


def atomic(path, text):
    temporary = path.with_suffix('.next')
    with temporary.open('w') as stream:
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
    if not isinstance(body, dict) or set(body) != {'enabled', 'domain', 'email'}:
        raise ValueError('Invalid settings.')
    domain = body['domain']
    email = body['email']
    if not isinstance(body['enabled'], bool) or not isinstance(domain, str) or not isinstance(email, str):
        raise ValueError('Invalid settings.')
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
    return {'enabled': body['enabled'], 'domain': domain, 'email': email}


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
    error_log stderr warn;
    client_max_body_size 16k;
    add_header Referrer-Policy no-referrer always;
    if (-f /var/lib/arrowcast-update/maintenance) {{ return 503; }}
    location ^~ /api/v1/scoring/ {{
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
    detail = '\n'.join(details[:3]) or 'The configuration command could not complete.'
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
    return {**value, 'available': True, 'busy': busy, 'active': active,
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
    with socketserver.UnixStreamServer(str(SOCKET), Handler) as server:
        shutil.chown(SOCKET, group='arrowcast')
        os.chmod(SOCKET, 0o660)
        server.serve_forever()


if __name__ == '__main__':
    main()
