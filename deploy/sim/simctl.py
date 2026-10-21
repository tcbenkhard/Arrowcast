#!/usr/bin/python3
"""Explicit controls for simulated hardware; never modifies host networking."""
import argparse
import json
from pathlib import Path

STATE = Path('/var/lib/arrowcast/sim-hardware.json')
DEFAULTS = {'ethernet': False, 'internet': True, 'wifi-failure': False}


def read_state():
    return {**DEFAULTS, **(json.loads(STATE.read_text()) if STATE.exists() else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('control', choices=[*DEFAULTS, 'status', 'log'])
    parser.add_argument('value', nargs='?')
    parser.add_argument('message', nargs='?')
    args = parser.parse_args()
    if args.control == 'status':
        print(json.dumps(read_state(), indent=2))
    elif args.control == 'log':
        if args.value not in ('backend', 'frontend', 'updates') or not args.message:
            parser.error('Use: simctl log backend|frontend|updates "message"')
        with Path(f'/var/log/arrowcast/{args.value}.log').open('a') as stream:
            stream.write(f'SIMULATION: {args.message}\n')
    else:
        if args.value not in ('on', 'off'):
            parser.error('Expected on or off')
        state = read_state()
        state[args.control] = args.value == 'on'
        temporary = STATE.with_suffix('.tmp')
        temporary.write_text(json.dumps(state))
        temporary.replace(STATE)
        print(json.dumps(state))


if __name__ == '__main__':
    main()
