#!/usr/bin/python3
"""Apply the fixed set of system files shipped in a verified, root-owned release.

The updater calls this after switching releases, and again after rollback.
Device settings, certificates and secrets are deliberately outside the release.
"""
from pathlib import Path
import os
import subprocess

FILES = Path(__file__).resolve().parent
UNITS = ('arrowcast.service', 'arrowcast-update.service', 'arrowcast-network.service',
         'arrowcast-public.service', 'arrowcast-certificate.service', 'arrowcast-certificate.timer')


def run(args):
    subprocess.run(args, check=True, timeout=240)


def copy(source, target):
    temporary = target.with_suffix('.next')
    temporary.write_bytes(source.read_bytes())
    os.chmod(temporary, 0o644)
    os.replace(temporary, target)


def main():
    # Stop certificate jobs before changing the generated public configuration.
    run(['systemctl', 'stop', 'arrowcast-certificate.timer', 'arrowcast-certificate.service',
         'arrowcast-public.service'])
    for name in UNITS:
        copy(FILES / name, Path('/etc/systemd/system') / name)
    copy(FILES / 'nginx.conf', Path('/etc/nginx/sites-available/arrowcast'))
    run(['nginx', '-t'])
    run(['systemctl', 'daemon-reload'])
    run(['python3', str(FILES / 'public-access.py'), '--reconcile'])
    run(['systemctl', 'reload', 'nginx'])
    run(['systemctl', 'restart', 'arrowcast-network.service', 'arrowcast-public.service'])
    run(['systemctl', 'enable', '--now', 'arrowcast-certificate.timer'])
    # The caller restarts the updater only after committing the transaction.


if __name__ == '__main__':
    main()
