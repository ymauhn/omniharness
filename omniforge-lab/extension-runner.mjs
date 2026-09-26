import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SANDBOX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'extension-sandbox.mjs');

/**
 * Run a reviewed extension module on scoped input and fail closed on anything but plain data.
 * ponytail: layered containment, not a certified sandbox — a context without host objects, no string code
 * generation, Node's --permission (no file writes, reads limited to the module, no child processes or workers),
 * a memory cap, a deadline and an output bound. Node 24 cannot deny sockets, but the context never receives a
 * reference that reaches them. Move to the Docker worker profile if extensions ever get richer inputs.
 */
export async function runExtension({ modulePath, input, timeoutMs = 5000, maxOutput = 256 * 1024, memoryMb = 64 }) {
  if (typeof modulePath !== 'string' || !fs.existsSync(modulePath) || !fs.statSync(modulePath).isFile()) {
    return { ok: false, reason: 'denied', error: 'Módulo da extensão ausente' };
  }
  const child = spawn(process.execPath, ['--permission', `--allow-fs-read=${SANDBOX}`, `--allow-fs-read=${path.resolve(modulePath)}`,
    '--disallow-code-generation-from-strings', `--max-old-space-size=${memoryMb}`, SANDBOX, path.resolve(modulePath), String(timeoutMs)],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { SystemRoot: process.env.SystemRoot ?? '' } });
  return await new Promise(resolve => {
    let output = '', settled = false;
    const finish = value => { if (settled) return; settled = true; clearTimeout(timer); child.kill(); resolve(value); };
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout', error: 'Tempo limite da extensão excedido' }), timeoutMs + 1000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > maxOutput) finish({ ok: false, reason: 'output-too-large', error: 'Resultado da extensão excede o limite' });
    });
    child.stderr.resume();
    child.on('error', error => finish({ ok: false, reason: 'crash', error: error.message }));
    child.on('close', () => {
      try {
        const reply = JSON.parse(output);
        finish(reply.ok === true && reply.result && typeof reply.result === 'object' ? { ok: true, result: reply.result }
          : { ok: false, reason: reply.reason || 'invalid-output', error: String(reply.error || 'Resultado inválido').slice(0, 300) });
      } catch { finish({ ok: false, reason: 'crash', error: 'A extensão terminou sem resultado válido' }); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(input ?? {}));
  });
}
