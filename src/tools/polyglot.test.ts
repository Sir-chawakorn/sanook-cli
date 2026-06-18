import { describe, expect, it } from 'vitest';
import { runtimeScriptSchema } from './polyglot.js';

describe('polyglot tool input schema', () => {
  it('accepts exactly one source selector', () => {
    expect(runtimeScriptSchema.safeParse({ code: 'print("ok")' }).success).toBe(true);
    expect(runtimeScriptSchema.safeParse({ path: 'script.py', args: ['a'], stdin: 'x' }).success).toBe(true);
    expect(runtimeScriptSchema.safeParse({}).success).toBe(false);
    expect(runtimeScriptSchema.safeParse({ code: 'print("ok")', path: 'script.py' }).success).toBe(false);
  });
});

