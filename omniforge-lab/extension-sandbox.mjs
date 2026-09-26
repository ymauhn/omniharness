// Child side of extension-runner.mjs. Runs under --permission with read access to this file only. The parent sends
// { source, input } on stdin: source is the module text whose hash it verified, a plain script defining check(input).
// It runs in a fresh context with no host objects; the input stays a string until it is parsed inside that context,
// and string code generation is disabled in both realms.
import vm from 'node:vm';

const timeout = Number(process.argv[2]) || 5000;
let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;
const reply = value => process.stdout.write(JSON.stringify(value));
try {
  const { source, input } = JSON.parse(stdin);
  const context = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(source, context, { timeout });
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
