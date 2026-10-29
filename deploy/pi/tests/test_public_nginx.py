"""Exercise the actual listener boundary when nginx is available (Linux CI)."""
import http.client
import http.server
import importlib.util
import json
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

FILES = Path(__file__).resolve().parents[1] / 'stage-arrowcast/00-install/files'
spec = importlib.util.spec_from_file_location('public_nginx', FILES / 'public-access.py')
public = importlib.util.module_from_spec(spec)
spec.loader.exec_module(public)


@unittest.skipUnless(shutil.which('nginx') and shutil.which('openssl'), 'Requires nginx and openssl')
class PublicNginxTests(unittest.TestCase):
    def test_public_listeners_cannot_reach_admin_but_scoring_and_acme_work(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            root.chmod(0o755)
            web = root / 'web'
            web.mkdir()
            (web / 'index.html').write_text('frontend')
            (web / 'assets').mkdir()
            (web / 'assets/app.css').write_text('body {}')
            acme = root / 'acme/.well-known/acme-challenge'
            acme.mkdir(parents=True)
            (acme / 'token').write_text('challenge')
            cert = root / 'certs/scores.club.nl'
            cert.mkdir(parents=True)
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-keyout', str(cert / 'privkey.pem'), '-out', str(cert / 'fullchain.pem'),
                            '-days', '1', '-subj', '/CN=scores.club.nl'], check=True, capture_output=True)
            with patch.object(public, 'CERTS', root / 'certs'), patch.object(public, 'WEBROOT', root / 'acme'):
                content = public.nginx({'enabled': True, 'domain': 'scores.club.nl'}, True)
            content = content.replace('/opt/arrowcast/current/apps/web/dist', str(web))
            content = content.replace('8080', '18081').replace('8443', '18443')
            content = content.replace('listen 80;', 'listen 18080;').replace('[::]:80;', '[::]:18080;')
            content = content.replace('listen 443 ssl;', 'listen 18444 ssl;').replace('[::]:443 ssl;', '[::]:18444 ssl;')
            local = (FILES / 'nginx.conf').read_text().replace('/opt/arrowcast/current/apps/web/dist', str(web))
            local = local.replace('listen 80', 'listen 18080').replace('[::]:80', '[::]:18080')
            conf = root / 'nginx.conf'
            scoring_requests = []

            class API(http.server.BaseHTTPRequestHandler):
                def do_GET(self):
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(self.path.encode())

                def do_POST(self):
                    if self.path.split('?')[0] == '/api/scores':
                        scoring_requests.append({
                            'path': self.path,
                            'body': self.rfile.read(int(self.headers.get('Content-Length', '0'))),
                            'authorization': self.headers.get('Authorization'),
                            'content_type': self.headers.get('Content-Type'),
                            'host': self.headers.get('Host'),
                            'protocol': self.headers.get('X-Forwarded-Proto'),
                            'address': self.headers.get('X-Forwarded-For'),
                        })
                        body = b'{"results":[{"score":276,"lidnummer":"100001","boogtype":"C"}]}'
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json')
                        self.send_header('Content-Length', str(len(body)))
                        self.end_headers()
                        self.wfile.write(body)
                        return
                    self.do_GET()

                def log_message(self, *_args):
                    pass

            with http.server.HTTPServer(('127.0.0.1', 0), API) as api:
                content = content.replace('127.0.0.1:3000', f'127.0.0.1:{api.server_port}')
                temp_paths = '\n'.join(f'{name}_temp_path {root}/{name};' for name in
                                       ('client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'))
                conf.write_text(f'pid {root}/nginx.pid;\nerror_log stderr;\nevents {{}}\n'
                                f'http {{\naccess_log off;\n{temp_paths}\n{local}\n{content}\n}}')
                thread = threading.Thread(target=api.serve_forever, daemon=True)
                thread.start()
                process = subprocess.Popen(['nginx', '-c', str(conf), '-p', str(root), '-g', 'daemon off;'],
                                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                try:
                    for _ in range(50):
                        try:
                            connection = http.client.HTTPConnection('127.0.0.1', 18081, timeout=1)
                            connection.request('GET', '/.well-known/acme-challenge/token')
                            response = connection.getresponse()
                            self.assertEqual((response.status, response.read()), (200, b'challenge'))
                            connection.close()
                            break
                        except OSError:
                            if process.poll() is not None:
                                self.fail(process.stderr.read().decode())
                            time.sleep(0.1)
                    else:
                        self.fail('nginx did not start')

                    connection = http.client.HTTPConnection('127.0.0.1', 18081)
                    connection.request('GET', '/admin')
                    response = connection.getresponse()
                    self.assertEqual(response.status, 404)
                    response.read()
                    connection.close()
                    # A public hostname on standard port 80 has the same safe
                    # challenge handler, never the local management SPA.
                    for port in (18080, 18081):
                        connection = http.client.HTTPConnection('127.0.0.1', port)
                        connection.request('GET', '/.well-known/acme-challenge/token', headers={'Host': 'scores.club.nl'})
                        response = connection.getresponse()
                        self.assertEqual((response.status, response.read()), (200, b'challenge'))
                        connection.close()
                        connection = http.client.HTTPConnection('127.0.0.1', port)
                        connection.request('GET', '/scores', headers={'Host': 'scores.club.nl'})
                        response = connection.getresponse()
                        self.assertEqual(response.getheader('Location'), 'https://scores.club.nl/scores')
                        response.read()
                        connection.close()
                        connection = http.client.HTTPConnection('127.0.0.1', port)
                        connection.request('POST', '/api/scores', headers={'Host': 'scores.club.nl'})
                        response = connection.getresponse()
                        self.assertEqual(response.status, 404)
                        response.read()
                        connection.close()
                    for path, expected in [('/', 404), ('/admin', 404), ('/admin/settings', 404),
                                           ('/api/v1/admin/me', 404), ('/api/v1/auth/login', 404),
                                           ('/api/v1/admin/api-tokens', 404), ('/api/v1/scoring', 404),
                                           ('/api/scores-other', 404), ('/api/scores/', 404),
                                           ('/scores', 200), ('/scores/competition/lane/grant', 200), ('/assets/app.css', 200),
                                           ('/api/v1/scoring/grant/context', 200)]:
                        with self.subTest(path=path):
                            connection = http.client.HTTPSConnection('127.0.0.1', 18443,
                                                                   context=ssl._create_unverified_context())
                            connection.request('GET', path)
                            response = connection.getresponse()
                            self.assertEqual(response.status, expected)
                            response.read()
                            connection.close()
                    for port in (18443, 18444):
                        connection = http.client.HTTPSConnection('127.0.0.1', port, context=ssl._create_unverified_context())
                        connection.request('GET', '/scoring/competition/lane/grant?lang=nl')
                        response = connection.getresponse()
                        self.assertEqual(response.status, 302)
                        self.assertEqual(response.getheader('Location'), 'https://scores.club.nl/scores/competition/lane/grant?lang=nl')
                        response.read()
                        connection.close()
                        for path, status in [('/admin',404),('/api/v1/admin/me',404),
                                             ('/api/v1/scoring',404),('/api/v1/scoring?source=integration',404),
                                             ('/scores',200)]:
                            connection = http.client.HTTPSConnection('127.0.0.1', port, context=ssl._create_unverified_context())
                            connection.request('GET', path)
                            response = connection.getresponse()
                            self.assertEqual(response.status,status)
                            response.read()
                            connection.close()
                        connection = http.client.HTTPSConnection('127.0.0.1', port, context=ssl._create_unverified_context())
                        request_body = b'{"verenigingsnummer":1241,"date":"2026-10-05","starttime":"10:00"}'
                        connection.request('POST', '/api/scores?source=integration', request_body, headers={
                            'Authorization': 'Bearer generated-api-key',
                            'Content-Type': 'application/json',
                            'X-Forwarded-Proto': 'http',
                            'X-Forwarded-For': '203.0.113.1',
                        })
                        response = connection.getresponse()
                        self.assertEqual(response.status, 200)
                        self.assertEqual(json.loads(response.read()), {
                            'results': [{'score': 276, 'lidnummer': '100001', 'boogtype': 'C'}],
                        })
                        self.assertIsNone(response.getheader('Location'))
                        connection.close()
                        self.assertEqual(scoring_requests[-1], {
                            'path': '/api/scores?source=integration',
                            'body': request_body,
                            'authorization': 'Bearer generated-api-key',
                            'content_type': 'application/json',
                            'host': 'scores.club.nl',
                            'protocol': 'https',
                            'address': '127.0.0.1',
                        })
                        for method in ('GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'):
                            with self.subTest(port=port, method=method):
                                connection = http.client.HTTPSConnection('127.0.0.1', port, context=ssl._create_unverified_context())
                                connection.request(method, '/api/scores')
                                response = connection.getresponse()
                                self.assertEqual(response.status, 403)
                                response.read()
                                connection.close()
                        for method in ('GET', 'POST'):
                            connection = http.client.HTTPSConnection('127.0.0.1', port, context=ssl._create_unverified_context())
                            connection.request(method, '/api/v1/admin/api-tokens')
                            response = connection.getresponse()
                            self.assertEqual(response.status, 404)
                            response.read()
                            connection.close()
                    self.assertEqual(len(scoring_requests), 2)
                    connection = http.client.HTTPSConnection('127.0.0.1', 18443,
                                                           context=ssl._create_unverified_context())
                    connection.request('POST', '/api/v1/scoring/grant/scores', '{}')
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    response.read()
                    connection.close()
                    connection = http.client.HTTPConnection('127.0.0.1', 18080)
                    connection.request('GET', '/admin')
                    response = connection.getresponse()
                    self.assertEqual((response.status, response.read()), (200, b'frontend'))
                    connection.close()
                    # A mistaken NAT mapping to the management listener must not
                    # serve the login or management APIs for a public hostname.
                    for host in ('scores.club.nl', 'scores.benkhard.com', 'unexpected.example.org'):
                        for path in ('/', '/admin', '/admin/settings', '/api/v1/admin/me', '/api/v1/auth/login'):
                            with self.subTest(management_host=host, path=path):
                                connection = http.client.HTTPConnection('127.0.0.1', 18080)
                                connection.request('GET', path, headers={'Host': host})
                                response = connection.getresponse()
                                self.assertEqual(response.status, 404)
                                self.assertNotIn(b'frontend', response.read())
                                connection.close()
                    for host in ('arrowcast.local', 'localhost', '192.168.68.120', '10.42.0.1', '172.16.0.5', '[fd59::120]'):
                        with self.subTest(local_host=host):
                            connection = http.client.HTTPConnection('127.0.0.1', 18080)
                            connection.request('GET', '/admin', headers={'Host': host})
                            response = connection.getresponse()
                            self.assertEqual((response.status, response.read()), (200, b'frontend'))
                            connection.close()
                finally:
                    process.terminate()
                    process.communicate(timeout=10)
                    api.shutdown()
                    thread.join()


if __name__ == '__main__':
    unittest.main()
