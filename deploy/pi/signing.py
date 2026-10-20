#!/usr/bin/env python3
"""Validate release signing configuration without logging key material."""
import argparse
import os
from pathlib import Path
import subprocess
import sys


def pem_value(name):
    value = os.environ.get(name, '').strip()
    # GitHub accepts multiline values. Also tolerate a single line containing
    # escaped newlines, a common result of copying a PEM through JSON.
    value = value.replace('\\r\\n', '\n').replace('\\n', '\n').replace('\r\n', '\n')
    if not value:
        raise ValueError(f'{name} is missing. Paste the full PEM file contents, not its filename.')
    if name.endswith('PUBLIC_KEY'):
        if not value.startswith(('-----BEGIN PUBLIC KEY-----', '-----BEGIN RSA PUBLIC KEY-----')):
            raise ValueError(f'{name} must contain a PEM public key including BEGIN/END PUBLIC KEY lines; '
                             'an SSH key, filename, private key or bare base64 value cannot be used.')
    return (value + '\n').encode()


def openssl(arguments, data, name):
    result = subprocess.run(['openssl', 'pkey', *arguments], input=data, capture_output=True, check=False)
    if result.returncode:
        raise ValueError(f'{name} is not a readable PEM key. Paste the complete file with its header, '
                         'body and footer. Private keys must be unencrypted.')
    return result.stdout


def validate(require_private=False):
    public_name = 'ARROWCAST_UPDATE_PUBLIC_KEY'
    public = openssl(['-pubin', '-pubout'], pem_value(public_name), public_name)
    private = None
    if require_private:
        private_name = 'ARROWCAST_UPDATE_PRIVATE_KEY'
        private = pem_value(private_name)
        derived = openssl(['-passin', 'pass:', '-pubout'], private, private_name)
        if derived != public:
            raise ValueError('ARROWCAST_UPDATE_PUBLIC_KEY does not match ARROWCAST_UPDATE_PRIVATE_KEY. '
                             'Export the public key from the configured private key using openssl pkey -pubout.')
    return public, private


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--require-private', action='store_true')
    parser.add_argument('--public-output', type=Path)
    parser.add_argument('--private-output', type=Path)
    args = parser.parse_args()
    try:
        public, private = validate(args.require_private or args.private_output is not None)
        if args.public_output:
            args.public_output.write_bytes(public)
        if args.private_output:
            descriptor = os.open(args.private_output, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(descriptor, 'wb') as stream:
                os.chmod(args.private_output, 0o600)
                stream.write(private)
    except (ValueError, OSError) as error:
        print(f'Update signing configuration error: {error}', file=sys.stderr)
        return 1
    print('Update signing configuration is valid.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
