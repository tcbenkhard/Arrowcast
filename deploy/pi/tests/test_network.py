import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch, MagicMock

SOURCE = Path(__file__).resolve().parents[1] / 'stage-arrowcast/00-install/files/network.py'
spec = importlib.util.spec_from_file_location('network', SOURCE)
network = importlib.util.module_from_spec(spec)
spec.loader.exec_module(network)
detect_ethernet = network.ethernet_connected


class NetworkTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        override = patch.object(network, 'PROFILE', Path(temporary.name) / 'client.nmconnection')
        override.start()
        self.addCleanup(override.stop)
        self.broker = network.Network()
        self.active = network.HOTSPOT
        self.radio = 'enabled'
        self.calls = []
        self.wired = False
        self.fail_wifi = False
        for name, replacement in [('nm', self.nm), ('dhcp', lambda enabled: self.calls.append(('dhcp', enabled))),
                                  ('ethernet_connected', lambda: self.wired)]:
            override = patch.object(network, name, replacement)
            override.start()
            self.addCleanup(override.stop)

    def nm(self, *args):
        self.calls.append(args)
        if args == ('radio', 'wifi'):
            return self.radio
        if args[:2] == ('radio', 'wifi'):
            self.radio = 'enabled' if args[2] == 'on' else 'disabled'
            self.active = ''
        if args[:3] == ('connection', 'up', 'uuid'):
            if args[3] == network.CLIENT and self.fail_wifi:
                raise subprocess.CalledProcessError(10, 'nmcli')
            self.active = args[3]
        if args[:2] == ('-g', 'GENERAL.CON-UUID'):
            return self.active
        if args[:2] == ('-g', 'IP4.ADDRESS'):
            return '192.168.1.20/24' if self.active == network.CLIENT else '10.42.0.1/24'
        return ''

    def test_cable_disables_radio_and_dhcp_even_without_an_ip(self):
        self.wired = True
        self.broker.reconcile()
        self.assertEqual(self.broker.snapshot()['mode'], 'ethernet')
        self.assertIn(('radio', 'wifi', 'off'), self.calls)
        self.assertIn(('dhcp', False), self.calls)
        self.assertNotIn(('connection', 'up', 'uuid', network.HOTSPOT), self.calls)

    def test_connectivity_requires_verified_https_response(self):
        for status, url, expected in [(204, network.CONNECTIVITY_URL, True),
                                      (200, network.CONNECTIVITY_URL, False),
                                      (204, 'https://portal.example/login', False)]:
            response = MagicMock(status=status, url=url)
            with patch.object(network.urllib.request, 'urlopen') as urlopen:
                urlopen.return_value.__enter__.return_value = response
                self.assertEqual(network.internet_available(), expected)
        with patch.object(network.urllib.request, 'urlopen', side_effect=OSError('unreachable')):
            self.assertFalse(network.internet_available())

    def test_connectivity_is_independent_of_network_mode_and_resets_after_switching(self):
        self.broker.update(mode='hotspot')
        with patch.object(network, 'internet_available', return_value=True):
            self.broker.check_connectivity()
        self.assertTrue(self.broker.snapshot()['internetAvailable'])
        self.broker.update(mode='ethernet')
        self.assertFalse(self.broker.snapshot()['internetAvailable'])
        with patch.object(network, 'internet_available', return_value=False):
            self.broker.check_connectivity()
        self.assertFalse(self.broker.snapshot()['internetAvailable'])

    def test_connectivity_result_from_previous_network_is_discarded(self):
        def probe():
            self.broker.update(mode='wifi')
            return True
        with patch.object(network, 'internet_available', side_effect=probe):
            self.broker.check_connectivity()
        self.assertFalse(self.broker.snapshot()['internetAvailable'])

    def test_carrier_detection_ignores_wifi_and_loopback(self):
        root = network.PROFILE.parent / 'net'
        root.mkdir()
        for name, kind, carrier in [('lo', '772', '1'), ('wlan0', '1', '1'), ('eth0', '1', '0')]:
            device = root / name
            device.mkdir()
            (device / 'type').write_text(kind)
            (device / 'carrier').write_text(carrier)
        (root / 'wlan0/wireless').mkdir()
        with patch.object(network, 'NET', root):
            self.assertFalse(detect_ethernet())
            (root / 'eth0/carrier').write_text('1')
            self.assertTrue(detect_ethernet())

    def test_unplug_restores_saved_wifi_without_hotspot_dhcp(self):
        network.save_profile('Club: Wi-Fi', 'correct password')
        self.wired = True
        self.broker.reconcile()
        self.wired = False
        with patch.object(network.subprocess, 'run'):
            self.broker.reconcile()
        state = self.broker.snapshot()
        self.assertEqual(state['mode'], 'wifi')
        self.assertEqual(state['ssid'], 'Club: Wi-Fi')
        self.assertEqual(state['address'], '192.168.1.20')
        self.assertEqual(self.radio, 'enabled')
        self.assertEqual(self.calls[-2], ('dhcp', False))

    def test_no_saved_network_starts_hotspot(self):
        self.active = ''
        self.broker.reconcile()
        self.assertEqual(self.broker.snapshot()['mode'], 'hotspot')
        self.assertIn(('dhcp', True), self.calls)

    def test_bad_wifi_restores_hotspot_without_repeated_interruptions(self):
        network.save_profile('Club', 'wrong-password')
        self.fail_wifi = True
        self.broker.reconcile()
        self.assertEqual(self.broker.snapshot()['mode'], 'hotspot')
        self.assertIn('Could not join', self.broker.snapshot()['message'])
        self.calls.clear()
        self.broker.reconcile()
        self.assertNotIn(('connection', 'up', 'uuid', network.CLIENT), self.calls)

    def test_cable_inserted_during_wifi_activation_wins(self):
        network.save_profile('Club', '')
        with patch.object(network, 'ethernet_connected', side_effect=[False, True]):
            self.broker.reconcile()
        self.assertEqual(self.radio, 'disabled')
        self.assertEqual(self.broker.snapshot()['mode'], 'ethernet')

    def test_credentials_stay_in_profile_and_are_not_returned(self):
        network.save_profile('Club; [wifi]', r'pass\word with spaces')
        self.assertEqual(network.saved_ssid(), 'Club; [wifi]')
        self.assertNotIn('password', self.broker.snapshot())
        self.assertFalse(any('pass' in str(call) for call in self.calls))
        self.assertIn(r'psk=pass\\word\swith\sspaces', network.PROFILE.read_text())

    def test_ssid_remains_readable_after_networkmanager_rewrites_profile(self):
        network.PROFILE.write_text('[wifi]\nssid=Club Wi-Fi\\s\n')
        self.assertEqual(network.saved_ssid(), 'Club Wi-Fi ')

    def test_validate_utf8_ssid_and_password_and_reject_duplicate_jobs(self):
        for body in [{'ssid': 'é' * 17, 'password': ''}, {'ssid': 'club', 'password': 'short'},
                     {'ssid': 'club\n', 'password': ''}, {'ssid': 'club', 'password': 'a' * 65},
                     {'ssid': 'club', 'password': '', 'command': 'reboot'}]:
            with self.assertRaises(ValueError):
                self.broker.submit(body)
        code, body = self.broker.submit({'ssid': 'Club', 'password': 'password'})
        self.assertEqual(code, 202)
        self.assertNotIn('password', body)
        self.assertEqual(self.broker.submit({'ssid': 'Other', 'password': ''})[0], 409)


if __name__ == '__main__':
    unittest.main()
