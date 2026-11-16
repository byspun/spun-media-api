// Data-only parser for the JavaScript object literals used in upstream SSR payloads.
// Parses the data subset without executing anything: no expressions, no function calls.
// `undefined` and `void 0` become null; objects get a null prototype so `__proto__` is plain data.
// Ported from ultrasrc src/utils/data-literal.ts.

const MAX_INPUT_LENGTH = 2 * 1024 * 1024;
const MAX_DEPTH = 64;
const MAX_NODES = 100000;

const SIMPLE_ESCAPES: Record<string, string> = {
  n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0',
  '\\': '\\', '"': '"', "'": "'", '/': '/',
};

export function parseDataLiteral(input: string): unknown {
  if (input.length > MAX_INPUT_LENGTH) throw new SyntaxError('Data literal exceeds size limit');
  let at = 0;
  let nodes = 0;

  function fail(): never {
    throw new SyntaxError(`Invalid data literal at offset ${at}`);
  }

  function skipSpace(): void {
    while (at < input.length && /\s/.test(input[at])) at++;
  }

  function parseEscape(): string {
    const ch = input[at++] ?? '';
    if (ch === 'x' || ch === 'u') {
      const size = ch === 'x' ? 2 : 4;
      const hex = input.slice(at, at + size);
      if (hex.length !== size || !/^[0-9a-f]+$/i.test(hex)) fail();
      at += size;
      return String.fromCharCode(parseInt(hex, 16));
    }
    if (ch === '\n') return '';
    if (ch === '\r') {
      if (input[at] === '\n') at++;
      return '';
    }
    if (Object.hasOwn(SIMPLE_ESCAPES, ch) && !(ch === '0' && /\d/.test(input[at] ?? ''))) return SIMPLE_ESCAPES[ch];
    return fail();
  }

  function parseString(): string {
    const quote = input[at++];
    let text = '';
    while (at < input.length) {
      const ch = input[at++];
      if (ch === quote) return text;
      if (ch === '\\') text += parseEscape();
      else if (ch.charCodeAt(0) < 32) fail();
      else text += ch;
    }
    return fail();
  }

  function parseArray(depth: number): unknown[] {
    at++;
    const items: unknown[] = [];
    skipSpace();
    while (input[at] !== ']') {
      items.push(parseValue(depth + 1));
      skipSpace();
      if (input[at] !== ',') break;
      at++;
      skipSpace();
    }
    if (input[at++] !== ']') fail();
    return items;
  }

  function parseKey(): string {
    if (input[at] === '"' || input[at] === "'") return parseString();
    const match = /^[A-Za-z_$][\w$]*/.exec(input.slice(at));
    if (!match) return fail();
    at += match[0].length;
    return match[0];
  }

  function parseObject(depth: number): Record<string, unknown> {
    at++;
    const object = Object.create(null) as Record<string, unknown>;
    skipSpace();
    while (input[at] !== '}') {
      const key = parseKey();
      skipSpace();
      if (input[at++] !== ':') fail();
      if (Object.hasOwn(object, key)) throw new SyntaxError('Duplicate data literal key');
      object[key] = parseValue(depth + 1);
      skipSpace();
      if (input[at] !== ',') break;
      at++;
      skipSpace();
    }
    if (input[at++] !== '}') fail();
    return object;
  }

  function parseValue(depth: number): unknown {
    if (depth > MAX_DEPTH || ++nodes > MAX_NODES) throw new SyntaxError('Data literal exceeds complexity limit');
    skipSpace();
    const ch = input[at];
    if (ch === '"' || ch === "'") return parseString();
    if (ch === '[') return parseArray(depth);
    if (ch === '{') return parseObject(depth);

    const rest = input.slice(at);
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(rest);
    if (number) {
      at += number[0].length;
      const result = Number(number[0]);
      if (!Number.isFinite(result)) fail();
      return result;
    }
    const word = /^(?:true|false|null|undefined|void\s+0)\b/.exec(rest);
    if (word) {
      at += word[0].length;
      return word[0] === 'true' ? true : word[0] === 'false' ? false : null;
    }
    return fail();
  }

  const result = parseValue(0);
  skipSpace();
  if (at !== input.length) fail();
  return result;
}