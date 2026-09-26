import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const PROVIDER = /^[a-z][a-z0-9-]{1,31}$/;
const MAX_SECRET = 4096;

// Windows Credential Manager through CredWriteW/CredReadW/CredDeleteW. The request, including any secret,
// travels on stdin, never in the command line; only the parent reads the reply.
const SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.Encoding]::UTF8
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class OmniForgeCredential {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL { public UInt32 Flags; public UInt32 Type; public string TargetName; public string Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist; public UInt32 AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName; }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWriteW(ref CREDENTIAL c, UInt32 flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string target, UInt32 type, UInt32 flags, out IntPtr c);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDeleteW(string target, UInt32 type, UInt32 flags);
  [DllImport("advapi32.dll")] static extern void CredFree(IntPtr c);
  public static void Write(string target, string secret) {
    byte[] bytes = Encoding.Unicode.GetBytes(secret);
    CREDENTIAL c = new CREDENTIAL(); c.Type = 1; c.TargetName = target; c.UserName = "OmniForge"; c.Persist = 2;
    c.CredentialBlobSize = (UInt32)bytes.Length; c.CredentialBlob = Marshal.AllocCoTaskMem(bytes.Length);
    try { Marshal.Copy(bytes, 0, c.CredentialBlob, bytes.Length); if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(); }
    finally { Marshal.FreeCoTaskMem(c.CredentialBlob); }
  }
  public static string Read(string target) {
    IntPtr p; if (!CredReadW(target, 1, 0, out p)) return null;
    try { CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL)); return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2); }
    finally { CredFree(p); }
  }
  public static bool Delete(string target) { return CredDeleteW(target, 1, 0); }
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.op -eq 'write') { [OmniForgeCredential]::Write($request.target, $request.secret); $reply = @{ ok = $true } }
elseif ($request.op -eq 'read') { $value = [OmniForgeCredential]::Read($request.target); $reply = @{ ok = $true; found = ($null -ne $value); secret = $value } }
else { $reply = @{ ok = [OmniForgeCredential]::Delete($request.target) } }
[Console]::Out.Write(($reply | ConvertTo-Json -Compress))
`;

export function windowsCredentialBackend({ timeoutMs = 20000 } = {}) {
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const call = request => new Promise((resolve, reject) => {
    const child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => { child.kill(); reject(Object.assign(new Error('Cofre do Windows não respondeu'), { status: 503 })); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(Object.assign(new Error(`Cofre do Windows indisponível: ${error.message}`), { status: 503 })); });
    child.on('close', code => {
      clearTimeout(timer);
      try { const reply = JSON.parse(out); if (code === 0) return resolve(reply); } catch { /* fall through */ }
      reject(Object.assign(new Error('Operação no cofre do Windows falhou'), { status: 503 }));
    });
    child.stdin.end(JSON.stringify(request));
  });
  return {
    async write(target, secret) { await call({ op: 'write', target, secret }); },
    async read(target) { const reply = await call({ op: 'read', target }); return reply.found ? reply.secret : null; },
    async remove(target) { return (await call({ op: 'delete', target })).ok === true; },
  };
}

/**
 * Optional provider API keys. Secrets live only in the OS vault under an opaque target; <dataDir>/keys.json keeps
 * provider, masked suffix, reference and last validation. Nothing here validates a key against a provider: that
 * is a network call that may consume credits and needs the owner's separate authorization.
 */
export class KeyVault {
  constructor({ dataDir, backend = windowsCredentialBackend() }) {
    this.file = path.join(dataDir, 'keys.json');
    this.backend = backend;
    this.queue = Promise.resolve();
  }

  /** One vault change at a time: two windows must not interleave their read-modify-write of keys.json. */
  serial(work) {
    const run = this.queue.then(work);
    this.queue = run.catch(() => {});
    return run;
  }

  list() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')).keys; }
    catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  }

  save(keys) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ schema: 1, keys }, null, 2));
    fs.renameSync(temp, this.file);
  }

  async store({ provider, secret }) {
    if (typeof provider !== 'string' || !PROVIDER.test(provider)) throw Object.assign(new Error('Provedor inválido'), { status: 400 });
    if (typeof secret !== 'string' || secret.trim() !== secret || secret.length < 12 || secret.length > MAX_SECRET) throw Object.assign(new Error('Chave inválida'), { status: 400 });
    return this.serial(async () => {
      this.list(); // unreadable metadata fails before any secret reaches the vault
      const ref = `OmniForge:key:${provider}:${randomUUID()}`;
      await this.backend.write(ref, secret);
      const row = { provider, ref, suffix: secret.slice(-4), createdAt: new Date().toISOString(), validation: { status: 'não verificada', at: null } };
      try { this.save([...this.list(), row]); }
      catch (error) { await this.backend.remove(ref).catch(() => {}); throw error; }
      return row;
    });
  }

  remove(ref) {
    return this.serial(async () => {
      if (!this.list().some(row => row.ref === ref)) throw Object.assign(new Error('Chave não encontrada'), { status: 404 });
      await this.backend.remove(ref);
      this.save(this.list().filter(row => row.ref !== ref));
    });
  }

  /** Coordinator-side only: never exposed over HTTP, logged or placed in agent context. */
  async secretFor(ref) {
    if (!this.list().some(row => row.ref === ref)) throw Object.assign(new Error('Chave não encontrada'), { status: 404 });
    return this.backend.read(ref);
  }
}
