import { describe, it, expect } from 'vitest';
import { encode, LspDecoder } from './framing.js';

describe('encode', () => {
  it('builds a Content-Length framed message with a byte (not char) length', () => {
    const frame = encode({ jsonrpc: '2.0', method: 'x' }).toString('utf8');
    expect(frame).toMatch(/^Content-Length: \d+\r\n\r\n/);
    const len = Number(/Content-Length: (\d+)/.exec(frame)![1]);
    const body = frame.split('\r\n\r\n')[1];
    expect(Buffer.byteLength(body, 'utf8')).toBe(len);
  });

  it('counts bytes for multibyte UTF-8 bodies', () => {
    const frame = encode({ text: 'ปิ๊ก' }).toString('utf8');
    const len = Number(/Content-Length: (\d+)/.exec(frame)![1]);
    expect(len).toBe(Buffer.byteLength(JSON.stringify({ text: 'ปิ๊ก' }), 'utf8'));
  });
});

describe('LspDecoder', () => {
  it('decodes a single complete frame', () => {
    const d = new LspDecoder();
    const msgs = d.push(encode({ id: 1, result: 'ok' }));
    expect(msgs).toEqual([{ id: 1, result: 'ok' }]);
  });

  it('decodes multiple back-to-back frames in one chunk', () => {
    const d = new LspDecoder();
    const buf = Buffer.concat([encode({ id: 1 }), encode({ id: 2 }), encode({ id: 3 })]);
    expect(d.push(buf)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  it('reassembles a frame split across chunks (header and body)', () => {
    const d = new LspDecoder();
    const full = encode({ method: 'split', params: { a: 1 } });
    expect(d.push(full.subarray(0, 10))).toEqual([]); // mid-header
    expect(d.push(full.subarray(10, 25))).toEqual([]); // mid-body (probably)
    expect(d.push(full.subarray(25))).toEqual([{ method: 'split', params: { a: 1 } }]);
  });

  it('handles multibyte bodies split mid-character', () => {
    const d = new LspDecoder();
    const full = encode({ text: 'ก้าวหน้า' });
    const cut = Math.floor(full.length / 2);
    d.push(full.subarray(0, cut));
    expect(d.push(full.subarray(cut))).toEqual([{ text: 'ก้าวหน้า' }]);
  });

  it('tolerates extra headers (Content-Type) before the body', () => {
    const d = new LspDecoder();
    const body = JSON.stringify({ ok: true });
    const frame = `Content-Length: ${Buffer.byteLength(body)}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n${body}`;
    expect(d.push(Buffer.from(frame))).toEqual([{ ok: true }]);
  });

  it('skips a malformed body without wedging the following frame', () => {
    const d = new LspDecoder();
    const bad = 'Content-Length: 3\r\n\r\n{ x'; // 3 bytes "{ x" → invalid JSON
    const good = encode({ id: 9 });
    expect(d.push(Buffer.concat([Buffer.from(bad), good]))).toEqual([{ id: 9 }]);
  });
});
