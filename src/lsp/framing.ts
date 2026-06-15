// ============================================================================
// src/lsp/framing.ts — LSP message framing (the wire codec).
//
// The Language Server Protocol speaks JSON-RPC 2.0 over a stream framed with HTTP-
// style headers: `Content-Length: <N>\r\n\r\n<N bytes of UTF-8 JSON>`, messages
// back to back. This differs from MCP's newline-delimited framing (src/mcp.ts),
// so it needs its own codec. Pure + dependency-free: encode() builds a frame,
// LspDecoder.push() accumulates bytes and yields whatever complete messages have
// arrived (headers and bodies may split across chunks). Fully unit-testable with
// zero process, zero server.
// ============================================================================

/** encode a JSON-RPC message as an LSP frame (Content-Length header + body). */
export function encode(msg: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(msg), 'utf8');
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii');
  return Buffer.concat([header, body]);
}

/**
 * Streaming decoder: feed it bytes, get back complete parsed messages. Tolerant of
 * messages split across chunks and of extra headers (e.g. Content-Type). A body
 * that fails to JSON-parse is skipped (defensive — a malformed frame must not wedge
 * the stream), and the byte length is counted via Content-Length, not characters,
 * so multibyte UTF-8 is handled correctly.
 */
export class LspDecoder {
  private buf: Buffer = Buffer.alloc(0);

  push(chunk: Buffer | string): unknown[] {
    this.buf = Buffer.concat([this.buf, typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk]);
    const out: unknown[] = [];
    for (;;) {
      const headerEnd = this.buf.indexOf('\r\n\r\n');
      if (headerEnd === -1) break; // headers not fully arrived yet
      const header = this.buf.subarray(0, headerEnd).toString('ascii');
      const m = /content-length:\s*(\d+)/i.exec(header);
      if (!m) {
        // no Content-Length in this header block — unrecoverable framing; drop it and resync
        this.buf = this.buf.subarray(headerEnd + 4);
        continue;
      }
      const len = Number(m[1]);
      const bodyStart = headerEnd + 4;
      if (this.buf.length < bodyStart + len) break; // body not fully arrived yet
      const body = this.buf.subarray(bodyStart, bodyStart + len).toString('utf8');
      this.buf = this.buf.subarray(bodyStart + len);
      try {
        out.push(JSON.parse(body));
      } catch {
        /* skip a malformed body rather than wedging the stream */
      }
    }
    return out;
  }
}
