import json
import socket
import urllib.request

with urllib.request.urlopen('http://127.0.0.1/api/v1/health', timeout=2) as response:
    assert response.status == 200
for service in ['network', 'public']:
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(2)
        client.connect(f'/run/arrowcast-{service}/control.sock')
        client.sendall(b'GET /status HTTP/1.0\r\n\r\n')
        chunks = []
        while chunk := client.recv(4096):
            chunks.append(chunk)
        state = json.loads(b''.join(chunks).split(b'\r\n\r\n', 1)[1])
        if service == 'network':
            assert state['mode'] != 'starting'
        else:
            assert state['available'] and state['simulation']
