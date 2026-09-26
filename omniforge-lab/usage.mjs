import { spawn } from 'node:child_process';

const ENV_KEYS = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'HOME', 'CODEX_HOME', 'LANG']);
const window = (label, value) => {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value.usedPercent) || value.usedPercent < 0) throw new Error('janela de quota inválida');
  return { label, usedPercent: value.usedPercent, windowMinutes: Number.isInteger(value.windowDurationMins) ? value.windowDurationMins : null,
    resetsAt: Number.isInteger(value.resetsAt) ? new Date(value.resetsAt * 1000).toISOString() : null };
};
const unknown = (reason, extra = {}) => ({ kind: 'subscription-quota', provider: 'codex', status: 'desconhecido', windows: null, reason,
  source: 'codex app-server account/rateLimits/read', scope: 'conta ChatGPT inteira, não esta tarefa', ...extra });

/**
 * One explicit, read-only quota read through the installed Codex App Server (initialize, then account/rateLimits/read).
 * It is an account-wide window, not a task receipt; failures stay unknown.
 */
export async function readCodexRateLimits({ codexPath, spawnProcess = spawn, timeoutMs = 15000, now = () => new Date() } = {}) {
  if (typeof codexPath !== 'string' || !codexPath) return unknown('Codex CLI não encontrado');
  let child;
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ENV_KEYS.has(key.toUpperCase())));
    child = spawnProcess(codexPath, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env });
  } catch (error) { return unknown(`Codex CLI indisponível: ${error.message}`); }
  return await new Promise(resolve => {
    let buffer = '', done = false;
    const finish = value => { if (done) return; done = true; clearTimeout(timer); try { child.kill(); } catch { /* already gone */ } resolve(value); };
    const timer = setTimeout(() => finish(unknown('O App Server do Codex não respondeu a tempo')), timeoutMs);
    const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
    child.on('error', error => finish(unknown(`Codex CLI indisponível: ${error.message}`)));
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1024 * 1024) return finish(unknown('Resposta do App Server grande demais'));
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { return finish(unknown('O App Server emitiu JSON inválido')); }
        if (message.id === 1) {
          if (message.error) return finish(unknown(`Inicialização recusada: ${String(message.error.message || '').slice(0, 200)}`));
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read', params: null });
        } else if (message.id === 2) {
          if (message.error) return finish(unknown(`Leitura recusada: ${String(message.error.message || '').slice(0, 200)}`));
          try {
            const limits = message.result?.rateLimits;
            if (!limits || typeof limits !== 'object') throw new Error('sem rateLimits');
            const windows = [window('principal', limits.primary), window('secundária', limits.secondary)].filter(Boolean);
            return finish({ kind: 'subscription-quota', provider: 'codex', status: 'observado', windows, plan: typeof limits.planType === 'string' ? limits.planType : null,
              credits: limits.credits && typeof limits.credits === 'object' ? { hasCredits: limits.credits.hasCredits === true, balance: limits.credits.balance ?? null } : null,
              source: 'codex app-server account/rateLimits/read', scope: 'conta ChatGPT inteira, não esta tarefa', observedAt: now().toISOString(), reason: null });
          } catch (error) { return finish(unknown(`Resposta de quota inválida: ${error.message}`)); }
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'omniforge', title: 'OmniForge usage panel', version: '0.1.0' }, capabilities: {} } });
  });
}

/** The four figures the panel shows side by side. Each has its own source; unknown is null, never zero. */
export function usageFigures({ codexQuota = null } = {}) {
  return [
    codexQuota ?? { kind: 'subscription-quota', provider: 'codex', status: 'não consultado', windows: null, value: null,
      reason: 'Consulte explicitamente; a janela do Claude só aparece dentro de uma sessão Claude Code (status line).',
      source: 'codex app-server account/rateLimits/read', scope: 'conta inteira, não esta tarefa' },
    { kind: 'measured-tokens', status: 'desconhecido', value: null, source: 'ledger de tentativas do harness',
      reason: 'Nenhuma execução gerenciada ocorreu neste workspace: a admissão gerenciada está fechada (V-04).', scope: 'por tarefa e host' },
    { kind: 'estimated-cost', status: 'desconhecido', value: null, source: 'estimativa do cliente a partir de recibos',
      reason: 'Sem recibos medidos não há estimativa; tokens nunca são convertidos em dólares aqui.', scope: 'por tarefa e host' },
    { kind: 'confirmed-billing', status: 'desconhecido', value: null, source: 'APIs de uso e custo dos provedores (credencial de administrador)',
      reason: 'Não configurado: exige uma chave de administrador própria e autorização separada.', scope: 'organização de API' },
  ];
}
