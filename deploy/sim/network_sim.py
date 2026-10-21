"""Run the production Pi broker with adapters for unavailable network hardware."""
import configparser
import importlib.util
from pathlib import Path
import subprocess

from simctl import read_state

spec = importlib.util.spec_from_file_location('network', '/usr/local/lib/arrowcast/network.py')
network = importlib.util.module_from_spec(spec)
spec.loader.exec_module(network)
network.PROFILE = Path('/var/lib/arrowcast/sim-client.nmconnection')


class Hardware:
    def __init__(self):
        self.radio = 'enabled'
        self.active = ''

    def nm(self, *args):
        if args == ('radio', 'wifi'):
            return self.radio
        if args[:2] == ('radio', 'wifi'):
            self.radio = 'enabled' if args[2] == 'on' else 'disabled'
            self.active = ''
        elif args[:3] == ('connection', 'up', 'uuid'):
            if args[3] == network.CLIENT:
                config = configparser.ConfigParser(interpolation=None)
                config.read(network.PROFILE)
                # A deterministic fixture, plus an explicit failure switch.
                if read_state()['wifi-failure'] or config.get('wifi-security', 'psk', fallback='') == 'wrong-password':
                    raise subprocess.CalledProcessError(10, 'nmcli')
            self.active = args[3]
            print(f'SIMULATION: activated {"wifi" if self.active == network.CLIENT else "hotspot"}', flush=True)
        elif args[:2] == ('-g', 'GENERAL.CON-UUID'):
            if self.active == network.CLIENT and read_state()['wifi-failure']:
                self.active = ''
            return self.active
        elif args[:2] == ('-g', 'IP4.ADDRESS'):
            return '192.168.50.20/24' if self.active == network.CLIENT else '10.42.0.1/24'
        elif args[:2] != ('connection', 'load'):
            raise ValueError(f'Unsupported simulated nmcli operation: {args}')
        return ''


def main():
    hardware = Hardware()
    network.nm = hardware.nm
    network.dhcp = lambda enabled: None
    network.ethernet_connected = lambda: read_state()['ethernet']
    network.internet_available = lambda: (
        read_state()['internet'] and (read_state()['ethernet'] or hardware.active == network.CLIENT)
    )
    network.main()


if __name__ == '__main__':
    main()
