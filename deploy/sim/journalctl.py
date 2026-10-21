#!/usr/bin/python3
"""Simulation-only journalctl adapter for the production logs API.

Supervisord and nginx write real process output to these files. This is not a
systemd journal and deliberately only supports the queries used by the API.
"""
from collections import deque
from pathlib import Path
import sys

SOURCES = {
    'SYSLOG_IDENTIFIER=arrowcast_web': 'frontend',
    '--unit=arrowcast.service': 'backend',
    '--unit=arrowcast-update.service': 'updates',
}
source = next((value for key, value in SOURCES.items() if key in sys.argv), None)
if source is None:
    sys.exit('Unsupported simulation journal query')
with Path(f'/var/log/arrowcast/{source}.log').open() as stream:
    sys.stdout.write(''.join(deque(stream, maxlen=300)))
