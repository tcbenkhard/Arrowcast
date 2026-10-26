import { request } from 'node:http';

export interface ControlResponse {
  code: number;
  body: unknown;
}

interface ControlCommand {
  socketPath: string;
  path: string;
  method: 'GET' | 'POST';
  timeoutMessage: string;
  body?: unknown;
  jsonHeaders?: boolean;
}

/** Sends a bounded JSON request to a local appliance broker. */
export function sendControlCommand(command: ControlCommand): Promise<ControlResponse> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: command.socketPath,
        path: command.path,
        method: command.method,
        timeout: 5000,
        ...(command.jsonHeaders ? { headers: { 'Content-Type': 'application/json' } } : {}),
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
          if (data.length > 65536) res.destroy(new Error('Control service response exceeds the size limit.'));
        });
        res.on('error', reject);
        res.on('end', () => {
          try {
            resolve({ code: res.statusCode ?? 503, body: JSON.parse(data) as unknown });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(command.timeoutMessage)));
    req.on('error', reject);
    req.end(command.body === undefined ? undefined : JSON.stringify(command.body));
  });
}
