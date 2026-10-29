"""Container initialization; persistent application data, ephemeral runtime and logs."""
import os
from pathlib import Path
import secrets
import shutil

data = Path('/var/lib/arrowcast')
data.mkdir(parents=True, exist_ok=True)
shutil.chown(data, user='arrowcast', group='arrowcast')
secret = data / 'sim-jwt-secret'
if not secret.exists():
    secret.write_text(secrets.token_hex(48))
    secret.chmod(0o600)
os.environ['JWT_SECRET'] = secret.read_text().strip()
for directory in ['/run/arrowcast-network', '/run/arrowcast-public', '/var/log/arrowcast']:
    Path(directory).mkdir(parents=True, exist_ok=True)
for source in ['backend', 'frontend', 'updates']:
    path = Path(f'/var/log/arrowcast/{source}.log')
    path.touch()
    path.chmod(0o644)
with Path('/var/log/arrowcast/updates.log').open('a') as stream:
    stream.write('SIMULATION: release installation is disabled; no systemd or signed Pi releases in this container.\n')
os.execvp('supervisord', ['supervisord', '-c', '/opt/sim/supervisord.conf'])
