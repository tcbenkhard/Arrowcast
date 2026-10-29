"""Production access broker with offline DNS, certificate and nginx adapters."""
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import subprocess

from simctl import read_state

spec = importlib.util.spec_from_file_location('public_access', '/usr/local/lib/arrowcast/public-access.py')
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)
public.STATE = Path('/var/lib/arrowcast/sim-public')
for name, filename in {'CONFIG': 'config.json', 'ERROR': 'error.txt', 'ATTEMPT': 'attempt.json',
                       'CHECKED': 'checked.txt', 'SITE': 'site.conf', 'ENABLED': 'enabled',
                       'WEBROOT': 'acme', 'CERTS': 'certs'}.items():
    setattr(public, name, public.STATE / filename)
ADDRESS = '203.0.113.20'


def online():
    if not read_state()['internet']:
        raise public.DdnsError('SIMULATION: internet is disabled. Enable it with simctl internet on.')


def request(path, token, method='GET', body=None):
    online()
    if token == 'invalid-token':
        raise public.DdnsError('SIMULATION: dynv6 rejected the API token.')
    name = body['name'] if method == 'POST' else public.ddns_config()['hostname']
    return {'id': 1, 'name': name, 'ipv4address': ADDRESS}


def address():
    online()
    return ADDRESS


def run(args):
    if args[0] != 'certbot':
        raise ValueError('Unsupported simulated command.')
    online()
    if args[1] in ('certonly', 'renew'):
        domain = args[args.index('--cert-name') + 1]
        path = public.CERTS / domain / 'fullchain.pem'
        path.parent.mkdir(parents=True, exist_ok=True)
        public.atomic(path, (datetime.now(timezone.utc) + timedelta(days=90)).isoformat())
    return subprocess.CompletedProcess(args, 0, stdout='', stderr='')


def certificate(domain):
    path = public.CERTS / domain / 'fullchain.pem'
    return path.read_text() if path.exists() else None


def main():
    public.ddns_request = request
    public.public_ipv4 = address
    public.hostname_addresses = lambda domain: {ADDRESS}
    public.run = run
    public.certificate = certificate
    public.install_site = lambda content: public.atomic(public.SITE, content)
    snapshot = public.snapshot
    public.snapshot = lambda: {**snapshot(), 'simulation': True}
    print('SIMULATION: public access, dynv6 and certificates are simulated; no external requests.', flush=True)
    public.main()


if __name__ == '__main__':
    main()
