// ============================================================================
// src/lsp/servers.ts — language → LSP server registry + availability detection.
//
// Zero-config floor: sanook does NOT bundle language servers (they're large and
// language-specific, like ripgrep). Instead it maps a file's extension to the
// conventional LSP server, detects whether that server is actually installed
// (PATH or node_modules/.bin), and degrades to a clear "install X" message when
// it isn't. Present server → real diagnostics; absent → graceful, never a crash.
// ============================================================================
import { access, constants } from 'node:fs/promises';
import { join, extname, delimiter } from 'node:path';

export interface ServerDef {
  id: string; // human id, e.g. 'typescript'
  command: string; // binary to spawn
  args: string[]; // stdio args
  /** ext (with dot) → LSP languageId */
  languages: Record<string, string>;
  install: string; // hint shown when the binary is missing
}

// conventional stdio language servers, by ecosystem. command is the binary NAME;
// resolveServer() finds it in node_modules/.bin or PATH.
export const SERVERS: ServerDef[] = [
  {
    id: 'typescript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    languages: { '.ts': 'typescript', '.tsx': 'typescriptreact', '.mts': 'typescript', '.cts': 'typescript', '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript', '.cjs': 'javascript' },
    install: 'npm i -g typescript-language-server typescript',
  },
  {
    id: 'python',
    command: 'pyright-langserver',
    args: ['--stdio'],
    languages: { '.py': 'python', '.pyi': 'python' },
    install: 'npm i -g pyright',
  },
  { id: 'go', command: 'gopls', args: [], languages: { '.go': 'go' }, install: 'go install golang.org/x/tools/gopls@latest' },
  { id: 'rust', command: 'rust-analyzer', args: [], languages: { '.rs': 'rust' }, install: 'rustup component add rust-analyzer' },
  {
    id: 'json',
    command: 'vscode-json-language-server',
    args: ['--stdio'],
    languages: { '.json': 'json', '.jsonc': 'jsonc' },
    install: 'npm i -g vscode-langservers-extracted',
  },
  { id: 'bash', command: 'bash-language-server', args: ['start'], languages: { '.sh': 'shellscript', '.bash': 'shellscript' }, install: 'npm i -g bash-language-server' },
];

/** the server def + languageId for a file, or null if no server is configured for that extension. */
export function serverDefForFile(filePath: string): { def: ServerDef; languageId: string } | null {
  const ext = extname(filePath).toLowerCase();
  for (const def of SERVERS) {
    const languageId = def.languages[ext];
    if (languageId) return { def, languageId };
  }
  return null;
}

/** resolve a binary name to an absolute path: node_modules/.bin first (project-local), then PATH. */
export async function findBinary(command: string, cwd: string = process.cwd()): Promise<string | null> {
  const candidates: string[] = [join(cwd, 'node_modules', '.bin', command)];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    candidates.push(join(dir, command));
    if (process.platform === 'win32') candidates.push(join(dir, `${command}.cmd`), join(dir, `${command}.exe`));
  }
  for (const c of candidates) {
    try {
      await access(c, constants.X_OK);
      return c;
    } catch {
      /* not here */
    }
  }
  return null;
}

export interface ResolvedServer {
  def: ServerDef;
  languageId: string;
  binPath: string;
}

/**
 * Resolve an installed server for a file. Returns the server + its absolute binary
 * path, or null with a `reason` (no server configured for the ext, or not installed).
 */
export async function resolveServer(
  filePath: string,
  cwd: string = process.cwd(),
): Promise<ResolvedServer | { unavailable: string }> {
  const match = serverDefForFile(filePath);
  if (!match) return { unavailable: `ไม่มี language server ที่รองรับนามสกุล "${extname(filePath) || '(none)'}"` };
  const binPath = await findBinary(match.def.command, cwd);
  if (!binPath) {
    return { unavailable: `ยังไม่ได้ติดตั้ง ${match.def.command} (สำหรับ ${match.def.id}) — ติดตั้ง: ${match.def.install}` };
  }
  return { def: match.def, languageId: match.languageId, binPath };
}
