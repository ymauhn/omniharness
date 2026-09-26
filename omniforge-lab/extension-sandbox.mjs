// Child side of extension-runner.mjs. Runs under --permission with read access to this file and the module only.
// The module is a plain script defining check(input); it runs in a fresh context with no host objects: the input
// arrives as a string and is parsed inside, and string code generation is disabled in both realms.
import fs from 'node:fs';
import vm from 'node:vm';

const [modulePath, timeoutArg] = process.argv.slice(2);
const timeout = Number(timeoutArg) || 5000;
let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) input += chunk;
const reply = value => process.stdout.write(JSON.stringify(value));
try {
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(fs.readFileSync(modulePath, 'utf8'), context, { timeout });
  const call = `(() => {
    if (typeof check !== 'function') return JSON.stringify({ invalid: 'check ausente' });
    const value = check(JSON.parse(${JSON.stringify(input)}));
    if (value === null || typeof value !== 'object' || typeof value.then === 'function') return JSON.stringify({ invalid: 'resultado não é um objeto de dados' });
    return JSON.stringify({ value });
  })()`;
  const output = JSON.parse(vm.runInContext(call, context, { timeout }));
  reply(output.invalid ? { ok: false, reason: 'invalid-output', error: output.invalid } : { ok: true, result: output.value });
} catch (error) {
  const message = String(error?.message || error).slice(0, 300);
  reply({ ok: false, reason: /timed out/i.test(message) ? 'timeout' : 'crash', error: message });
}
