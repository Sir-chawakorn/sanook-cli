import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exactMatch, whitespaceFlexMatch, findMatch, editFileTool } from './edit.js';
import { checkBash, checkReadPath, checkWritePath } from './permission.js';
import { readFileTool } from './read.js';
import { writeFileTool } from './write.js';
import { listDirTool } from './list.js';
import { globTool } from './search.js';

// stub ToolCallOptions พอให้ execute ทำงานใน test
const opts = { toolCallId: 't', messages: [], abortSignal: undefined } as never;

describe('edit matcher (pure functions)', () => {
  it('exactMatch หา substring + offset ถูก', () => {
    expect(exactMatch('a foo b', 'foo')).toEqual({ start: 2, end: 5, count: 1 });
  });
  it('exactMatch นับจำนวนซ้ำ', () => {
    expect(exactMatch('foo foo foo', 'foo')?.count).toBe(3);
  });
  it('exactMatch นับ overlapping ถูก (aaa/aa = 2, \\n\\n\\n/\\n\\n = 2)', () => {
    expect(exactMatch('aaa', 'aa')?.count).toBe(2);
    expect(exactMatch('\n\n\n', '\n\n')?.count).toBe(2);
  });
  it('exactMatch คืน null เมื่อ needle ว่าง (กัน infinite loop)', () => {
    expect(exactMatch('abc', '')).toBeNull();
  });
  it('whitespaceFlexMatch คืน null เมื่อ needle ว่าง', () => {
    expect(whitespaceFlexMatch('abc', '')).toBeNull();
    expect(whitespaceFlexMatch('\n', '')).toBeNull();
  });
  it('findMatch คืน null เมื่อ needle ว่าง', () => {
    expect(findMatch('abc', '')).toBeNull();
    expect(findMatch('\n', '')).toBeNull();
  });
  it('exactMatch คืน null เมื่อไม่เจอ', () => {
    expect(exactMatch('abc', 'xyz')).toBeNull();
  });
  it('whitespaceFlexMatch ครอบบรรทัดเต็ม (รวม indent เดิม)', () => {
    const content = 'line1\n    foo();\nline3';
    const m = whitespaceFlexMatch(content, 'foo();');
    expect(content.slice(m!.start, m!.end)).toBe('    foo();');
  });
  it('whitespaceFlexMatch จับ multi-line ที่ indent ต่างกัน', () => {
    const content = '  if (x) {\n    return;\n  }';
    const m = whitespaceFlexMatch(content, 'if (x) {\nreturn;\n}');
    expect(content.slice(m!.start, m!.end)).toBe('  if (x) {\n    return;\n  }');
  });
  it('findMatch ใช้ exact ก่อน, fallback whitespace-flex', () => {
    // exact fail (indent ต่าง), flex เจอ
    const content = '  if (x) {\n    return;\n  }';
    const m = findMatch(content, 'if (x) {\nreturn;\n}');
    expect(m).not.toBeNull();
    expect(m!.count).toBe(1);
  });
});

describe('permission gate', () => {
  it('block rm -rf', () => expect(checkBash('rm -rf /tmp/x').ok).toBe(false));
  it('block rm -fr และ rm -r -f', () => {
    expect(checkBash('rm -fr /tmp/x').ok).toBe(false);
    expect(checkBash('rm -r -f /tmp/x').ok).toBe(false);
  });
  it('block rm --recursive --force', () => {
    expect(checkBash('rm --recursive --force /tmp/x').ok).toBe(false);
    expect(checkBash('rm --force --recursive /tmp/x').ok).toBe(false);
  });
  it('allows literal rm -rf text in single-quoted search patterns only', () => {
    expect(checkBash("grep 'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("grep -R -e 'rm -rf' .").ok).toBe(true);
    expect(checkBash("grep -e'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("grep -Re'rm -rf' .").ok).toBe(true);
    expect(checkBash("grep --regexp='rm -rf' README.md").ok).toBe(true);
    expect(checkBash("grep -- 'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("grep -C 2 'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("grep --max-count 1 'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("grep --include '*.md' 'rm -rf' .").ok).toBe(true);
    expect(checkBash("env FOO=bar grep 'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("rg 'rm -rf' src").ok).toBe(true);
    expect(checkBash("rg -e 'rm -rf' src").ok).toBe(true);
    expect(checkBash("rg -e'rm -rf' src").ok).toBe(true);
    expect(checkBash("rg -- 'rm -rf' src").ok).toBe(true);
    expect(checkBash("rg --context 2 'rm -rf' src").ok).toBe(true);
    expect(checkBash("echo grep 'rm -rf /tmp/x'").ok).toBe(false);
    expect(checkBash("grep -e safe 'rm -rf' README.md").ok).toBe(false);
    expect(checkBash("grep -me'rm -rf' README.md").ok).toBe(false);
    expect(checkBash("grep -f patterns.txt 'rm -rf' README.md").ok).toBe(false);
    expect(checkBash("grep --file patterns.txt 'rm -rf' README.md").ok).toBe(false);
    expect(checkBash("grep -f patterns.txt -e 'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("rg -e safe 'rm -rf' src").ok).toBe(false);
    expect(checkBash("rg -f patterns.txt 'rm -rf' src").ok).toBe(false);
    expect(checkBash('grep "$(rm -rf /tmp/x)" README.md').ok).toBe(false);
    expect(checkBash('node -e \'require("child_process").execSync(process.argv[2])\' grep \'rm -rf /tmp/x\'').ok).toBe(false);
    expect(checkBash('node -e \'require("child_process").execSync("rm -rf /tmp/x")\'').ok).toBe(false);
  });
  it('allows literal destructive git text in single-quoted search patterns only', () => {
    expect(checkBash("grep 'git push --force' README.md").ok).toBe(true);
    expect(checkBash("grep -e 'git reset --hard' README.md").ok).toBe(true);
    expect(checkBash("grep --regexp='git clean -fdx' README.md").ok).toBe(true);
    expect(checkBash("grep -- 'git reset --hard' README.md").ok).toBe(true);
    expect(checkBash("rg 'git push --force-with-lease' src").ok).toBe(true);
    expect(checkBash("rg -ie'git clean -fdx' src").ok).toBe(true);
    expect(checkBash("rg -e 'git push origin :main' src").ok).toBe(true);
    expect(checkBash("rg -- 'git clean -fdx' src").ok).toBe(true);
    expect(checkBash("rg -g '*.ts' 'git clean -fdx' src").ok).toBe(true);
    expect(checkBash("echo 'git push --force'").ok).toBe(false);
    expect(checkBash("grep -e safe 'git push --force' README.md").ok).toBe(false);
    expect(checkBash("grep -f patterns.txt 'git push --force' README.md").ok).toBe(false);
    expect(checkBash("grep --file=patterns.txt 'git reset --hard' README.md").ok).toBe(false);
    expect(checkBash("rg -e safe 'git push --force' src").ok).toBe(false);
    expect(checkBash("rg -me'git clean -fdx' src").ok).toBe(false);
    expect(checkBash("rg -f patterns.txt 'git clean -fdx' src").ok).toBe(false);
    expect(checkBash("rg --file patterns.txt 'git push origin :main' src").ok).toBe(false);
    expect(checkBash("rg -f patterns.txt -e 'git clean -fdx' src").ok).toBe(true);
    expect(checkBash('node -e \'console.log("git reset --hard")\'').ok).toBe(false);
    expect(checkBash('grep "$(git push --force)" README.md').ok).toBe(false);
    expect(checkBash("grep 'git push --force' README.md && git push --force origin main").ok).toBe(false);
  });
  it('allows other destructive literals in single-quoted search patterns only', () => {
    expect(checkBash("grep 'sudo' README.md").ok).toBe(true);
    expect(checkBash("grep 'crontab' README.md").ok).toBe(true);
    expect(checkBash("grep 'chmod -R 777' README.md").ok).toBe(true);
    expect(checkBash("grep 'dd if=/dev/zero' README.md").ok).toBe(true);
    expect(checkBash("rg 'mkfs' src").ok).toBe(true);
    expect(checkBash("echo 'sudo'").ok).toBe(false);
    expect(checkBash("grep -e safe 'crontab' README.md").ok).toBe(false);
    expect(checkBash('grep "$(sudo whoami)" README.md').ok).toBe(false);
  });
  it('allows literal destructive search text after shell prefixes and control flow', () => {
    expect(checkBash("command grep 'rm -rf' README.md").ok).toBe(true);
    expect(checkBash("time rg 'git clean -fdx' src").ok).toBe(true);
    expect(checkBash("if grep 'git reset --hard' README.md; then echo ok; fi").ok).toBe(true);
    expect(checkBash("while rg 'git push --force' src; do break; done").ok).toBe(true);
    expect(checkBash("if grep 'git reset --hard' README.md; then git reset --hard HEAD~1; fi").ok).toBe(false);
  });
  it('block destructive commands inside nested shell -c payloads', () => {
    expect(checkBash("bash -c 'rm -rf /tmp/x'").ok).toBe(false);
    expect(checkBash("bash -c'rm -rf /tmp/x'").ok).toBe(false);
    expect(checkBash('sh -lc "git reset --hard HEAD~2"').ok).toBe(false);
    expect(checkBash("env -u PATH bash -lc 'rm -rf /tmp/x'").ok).toBe(false);
  });
  it('block git reset --hard', () => expect(checkBash('git reset --hard HEAD~2').ok).toBe(false));
  it('block git push force flags', () => {
    expect(checkBash('git push origin main --force').ok).toBe(false);
    expect(checkBash('git push -f origin main').ok).toBe(false);
    expect(checkBash('git push --force-with-lease origin main').ok).toBe(false);
    expect(checkBash('git push origin +main').ok).toBe(false);
    expect(checkBash('git push origin +HEAD:main').ok).toBe(false);
    expect(checkBash('git push origin -- +HEAD:main').ok).toBe(false);
    expect(checkBash('git -C repo push -f origin main').ok).toBe(false);
    expect(checkBash('git -Crepo push -f origin main').ok).toBe(false);
    expect(checkBash('git -c protocol.version=2 push --force origin main').ok).toBe(false);
    expect(checkBash('git -cprotocol.version=2 push --force origin main').ok).toBe(false);
    expect(checkBash('git --git-dir repo/.git --work-tree repo push --force-with-lease origin main').ok).toBe(false);
    expect(checkBash('git --git-dir=repo/.git --work-tree=repo push --force-with-lease origin main').ok).toBe(false);
    expect(checkBash("bash -lc 'git push -f origin main'").ok).toBe(false);
    expect(checkBash("env -u PATH git push --force origin main").ok).toBe(false);
    expect(checkBash('git push -- -f').ok).toBe(true);
    expect(checkBash('git -C repo status -- -f').ok).toBe(true);
  });
  it('block git push remote deletion flags and refspecs', () => {
    expect(checkBash('git push origin --delete main').ok).toBe(false);
    expect(checkBash('git push -d origin main').ok).toBe(false);
    expect(checkBash('git push origin -d main').ok).toBe(false);
    expect(checkBash('git push -dn origin main').ok).toBe(false);
    expect(checkBash('git push origin -dn main').ok).toBe(false);
    expect(checkBash('git push -vd origin main').ok).toBe(false);
    expect(checkBash('git push --mirror origin').ok).toBe(false);
    expect(checkBash('git push --prune origin').ok).toBe(false);
    expect(checkBash('git push origin :main').ok).toBe(false);
    expect(checkBash('git push origin +:refs/heads/main').ok).toBe(false);
    expect(checkBash('git push origin -- :main').ok).toBe(false);
    expect(checkBash("bash -lc 'git push origin :main'").ok).toBe(false);
    expect(checkBash("env -u PATH git push --delete origin main").ok).toBe(false);
    expect(checkBash('git push origin HEAD:main').ok).toBe(true);
    expect(checkBash('git push origin -- --delete').ok).toBe(true);
  });
  it('block dangerous inline git aliases', () => {
    expect(checkBash("git -c alias.fp='push -f' fp origin main").ok).toBe(false);
    expect(checkBash("git -c alias.fp='push' fp --force origin main").ok).toBe(false);
    expect(checkBash("git -calias.del='push origin :main' del").ok).toBe(false);
    expect(checkBash("git -c alias.fp='!git push -f' fp origin main").ok).toBe(false);
    expect(checkBash("git -c alias.rh='reset --hard' rh HEAD~1").ok).toBe(false);
    expect(checkBash("git -c alias.wipe='clean -fdx' wipe").ok).toBe(false);
    expect(checkBash("GIT_ALIAS_FP='push -f' git --config-env=alias.fp=GIT_ALIAS_FP fp origin main").ok).toBe(false);
    expect(checkBash("GIT_ALIAS_DEL='push origin :main' git --config-env alias.del=GIT_ALIAS_DEL del").ok).toBe(false);
    expect(checkBash("GIT_ALIAS_SHELL='!git push -f' git --config-env=alias.fp=GIT_ALIAS_SHELL fp origin main").ok).toBe(false);
    expect(checkBash("GIT_ALIAS_RH='reset --hard' git --config-env=alias.rh=GIT_ALIAS_RH rh HEAD~1").ok).toBe(false);
    expect(checkBash("GIT_ALIAS_WIPE='clean -fdx' git --config-env=alias.wipe=GIT_ALIAS_WIPE wipe").ok).toBe(false);
    expect(checkBash("env -- GIT_ALIAS_FP='push -f' git --config-env=alias.fp=GIT_ALIAS_FP fp origin main").ok).toBe(false);
    expect(checkBash("git --config-env=alias.fp=GIT_ALIAS_FROM_ENV fp origin main").ok).toBe(false);
    expect(
      checkBash("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.fp GIT_CONFIG_VALUE_0='push -f' git fp origin main").ok,
    ).toBe(false);
    expect(
      checkBash("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.rh GIT_CONFIG_VALUE_0='reset --hard' git rh HEAD~1").ok,
    ).toBe(false);
    expect(
      checkBash("env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.del GIT_CONFIG_VALUE_0='push origin :main' git del").ok,
    ).toBe(false);
    expect(checkBash('GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.fp git fp origin main').ok).toBe(false);
    expect(
      checkBash(
        "GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_1=alias.fp GIT_CONFIG_VALUE_1='push -f' GIT_CONFIG_KEY_0=alias.fp GIT_CONFIG_VALUE_0='status --short' git fp origin main",
      ).ok,
    ).toBe(false);
    expect(checkBash("git -c alias.st='status --short' st").ok).toBe(true);
    expect(checkBash("GIT_ALIAS_ST='status --short' git --config-env=alias.st=GIT_ALIAS_ST st").ok).toBe(true);
    expect(checkBash("env -- GIT_ALIAS_ST='status --short' git --config-env=alias.st=GIT_ALIAS_ST st").ok).toBe(true);
    expect(checkBash("git --config-env=alias.fp=GIT_ALIAS_FROM_ENV status").ok).toBe(true);
    expect(
      checkBash("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.st GIT_CONFIG_VALUE_0='status --short' git st").ok,
    ).toBe(true);
    expect(
      checkBash("GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.fp GIT_CONFIG_VALUE_0='push -f' git status").ok,
    ).toBe(true);
  });
  it('block forced git clean commands', () => {
    expect(checkBash('git clean -f').ok).toBe(false);
    expect(checkBash('git clean -fdx').ok).toBe(false);
    expect(checkBash('git clean --force -d').ok).toBe(false);
    expect(checkBash('git -C repo clean -fd').ok).toBe(false);
    expect(checkBash("bash -lc 'git clean -fdx'").ok).toBe(false);
    expect(checkBash('git clean -nfd').ok).toBe(true);
    expect(checkBash('git clean --dry-run --force').ok).toBe(true);
    expect(checkBash('git clean -- -f').ok).toBe(true);
  });
  it('allow reading .env.example documentation through bash guard', () => {
    expect(checkBash('cat .env.example').ok).toBe(true);
    expect(checkBash("sed -n '1,20p' .env.example").ok).toBe(true);
    expect(checkBash('cat <.env.example').ok).toBe(true);
    expect(checkBash('echo safe > .env.example').ok).toBe(true);
    expect(checkBash('echo $(<.env.example)').ok).toBe(true);
    expect(checkBash('echo safe | tee .env.example').ok).toBe(true);
    expect(checkBash("bash -lc 'cat .env.example'").ok).toBe(true);
    expect(checkBash('sh -c "echo safe > .env.example"').ok).toBe(true);
    expect(checkBash('grep API_KEY .env.example').ok).toBe(true);
    expect(checkBash('diff <(cat .env.example) expected.txt').ok).toBe(true);
    expect(checkBash('node -e "require(\'fs\').readFileSync(\'.env.example\')"').ok).toBe(true);
    expect(checkBash('node --env-file=.env.example app.js').ok).toBe(true);
    expect(checkBash('node --env-file=.en"v".example app.js').ok).toBe(true);
    expect(checkBash('docker run --env-file .env.example app').ok).toBe(true);
    expect(checkBash("cat $'.env.example'").ok).toBe(true);
    expect(checkBash("cat $'.env.\\x65xample'").ok).toBe(true);
    expect(checkBash('cat $".env.example"').ok).toBe(true);
    expect(checkBash("bash -lc $'cat .env.example'").ok).toBe(true);
  });
  it('block reading secret .env variants through bash guard', () => {
    expect(checkBash('cat .env').ok).toBe(false);
    expect(checkBash('cat .env/secret').ok).toBe(false);
    expect(checkBash('cat config/.env.local').ok).toBe(false);
    expect(checkBash('cat config/.env.local/API_KEY').ok).toBe(false);
    expect(checkBash('cat .env.example.backup').ok).toBe(false);
    expect(checkBash('cat config/.env.example.backup/value').ok).toBe(false);
    expect(checkBash('cat <.env').ok).toBe(false);
    expect(checkBash('sed -n 1p <.env.local').ok).toBe(false);
    expect(checkBash('echo $(<.env)').ok).toBe(false);
    expect(checkBash('echo $(< config/.env.local)').ok).toBe(false);
    expect(checkBash('echo safe > .env').ok).toBe(false);
    expect(checkBash('printf x >>.env.local').ok).toBe(false);
    expect(checkBash('echo safe | tee .env').ok).toBe(false);
    expect(checkBash('printf x | tee -a config/.env.local').ok).toBe(false);
    expect(checkBash('printf x | tee -- .env').ok).toBe(false);
    expect(checkBash('source .env').ok).toBe(false);
    expect(checkBash('. .env.local').ok).toBe(false);
    expect(checkBash('env -u API_KEY cat .env').ok).toBe(false);
    expect(checkBash('env --unset API_KEY cat .env.local').ok).toBe(false);
    expect(checkBash('env -C config cat .env.local').ok).toBe(false);
    expect(checkBash("env -S 'cat .env'").ok).toBe(false);
    expect(checkBash("env -S'cat .env.local'").ok).toBe(false);
    expect(checkBash("env -Sbash -lc 'cat .env'").ok).toBe(false);
    expect(checkBash("env -S'cat' .env.local").ok).toBe(false);
    expect(checkBash('env --split-string="cat .env.local"').ok).toBe(false);
    expect(checkBash("env --split-string='cat' .env.local").ok).toBe(false);
    expect(checkBash("env -S 'bash -lc \"cat .env\"'").ok).toBe(false);
    expect(checkBash("bash -lc 'cat .env'").ok).toBe(false);
    expect(checkBash("bash -lc'cat .env'").ok).toBe(false);
    expect(checkBash("bash --rcfile /tmp/bashrc -c 'cat .env'").ok).toBe(false);
    expect(checkBash("env -u API_KEY bash -lc 'cat .env'").ok).toBe(false);
    expect(checkBash('sh -c "echo safe > .env.local"').ok).toBe(false);
    expect(checkBash('echo $(bash -c "cat .env")').ok).toBe(false);
    expect(checkBash('grep API_KEY .env').ok).toBe(false);
    expect(checkBash('rg API_KEY config/.env.local').ok).toBe(false);
    expect(checkBash('echo $(cat .env)').ok).toBe(false);
    expect(checkBash('echo `cat .env.local`').ok).toBe(false);
    expect(checkBash('if cat .env; then echo ok; fi').ok).toBe(false);
    expect(checkBash('while cat .env.local; do break; done').ok).toBe(false);
    expect(checkBash('time cat .env').ok).toBe(false);
    expect(checkBash('command cat .env').ok).toBe(false);
    expect(checkBash("grep -E 'API_KEY|TOKEN' .env").ok).toBe(false);
    expect(checkBash('grep --file=.env haystack.txt').ok).toBe(false);
    expect(checkBash("grep --file='.env' haystack.txt").ok).toBe(false);
    expect(checkBash('grep -R --include=.env API_KEY .').ok).toBe(false);
    expect(checkBash('grep -R --include=".env.local" API_KEY .').ok).toBe(false);
    expect(checkBash('rg --file=.env.local needle .').ok).toBe(false);
    expect(checkBash('rg --glob=.env.local API_KEY .').ok).toBe(false);
    expect(checkBash("rg --glob='.env.local' API_KEY .").ok).toBe(false);
    expect(checkBash('rg -g.env API_KEY .').ok).toBe(false);
    expect(checkBash("rg -g'.env.local' API_KEY .").ok).toBe(false);
    expect(checkBash('sed -f.env input.txt').ok).toBe(false);
    expect(checkBash('sed -f".env.local" input.txt').ok).toBe(false);
    expect(checkBash("awk 'BEGIN { print \"a;b\" } { print }' .env.local").ok).toBe(false);
    expect(checkBash('awk -f.env.local input.txt').ok).toBe(false);
    expect(checkBash("awk -f'.env.local' input.txt").ok).toBe(false);
    expect(checkBash('env LC_ALL=C cat .env').ok).toBe(false);
    expect(checkBash('cat \\.env').ok).toBe(false);
    expect(checkBash('echo ok\ncat .env').ok).toBe(false);
    expect(checkBash('echo ok\r\ncat .env.local').ok).toBe(false);
    expect(checkBash('diff <(cat .env) expected.txt').ok).toBe(false);
    expect(checkBash('comm <(sed -n 1p .env.local) safe.txt').ok).toBe(false);
    expect(checkBash('node -e "require(\'fs\').readFileSync(\'.env\')"').ok).toBe(false);
    expect(checkBash("python -c 'open(\"config/.env.local\").read()'").ok).toBe(false);
    expect(checkBash('tar -czf env.tgz .env.local').ok).toBe(false);
    expect(checkBash('node --env-file=.env app.js').ok).toBe(false);
    expect(checkBash('cat .en"v"').ok).toBe(false);
    expect(checkBash('node --env-file=.en"v" app.js').ok).toBe(false);
    expect(checkBash('docker run --env-file config/.en"v".local app').ok).toBe(false);
    expect(checkBash('docker run --env-file config/.env.local app').ok).toBe(false);
    expect(checkBash("cat $'.env'").ok).toBe(false);
    expect(checkBash("cat $'.e\\x6ev'").ok).toBe(false);
    expect(checkBash("cat $'\\U0000002eenv'").ok).toBe(false);
    expect(checkBash("cat $'\\056env'").ok).toBe(false);
    expect(checkBash('cat $".env"').ok).toBe(false);
    expect(checkBash("cat config/$'.env.local'").ok).toBe(false);
    expect(checkBash("cat < $'.env.local'").ok).toBe(false);
    expect(checkBash("node --env-file=$'.env' app.js").ok).toBe(false);
    expect(checkBash("bash -lc $'cat .env'").ok).toBe(false);
    expect(checkBash("bash -lc $'cat .e\\x6ev'").ok).toBe(false);
    expect(checkBash("sh -c $'echo safe > .env.local'").ok).toBe(false);
  });
  it('handles malformed ANSI-C unicode escapes without crashing', () => {
    expect(() => checkBash("cat $'\\U00110000'")).not.toThrow();
  });
  it('allow reader options that exclude protected env files or target .env.example', () => {
    expect(checkBash('grep -R --include=.env.example SAFE .').ok).toBe(true);
    expect(checkBash('grep -R --exclude=.env API_KEY .').ok).toBe(true);
    expect(checkBash('grep -R --exclude-dir=.env.local API_KEY .').ok).toBe(true);
    expect(checkBash('rg --glob=!.env API_KEY .').ok).toBe(true);
    expect(checkBash("rg --glob='!.env' API_KEY .").ok).toBe(true);
    expect(checkBash('rg -g!.env.local API_KEY .').ok).toBe(true);
    expect(checkBash("env -S 'cat .env.example'").ok).toBe(true);
    expect(checkBash("env -S'cat' .env.example").ok).toBe(true);
    expect(checkBash('env --split-string="cat .env.example"').ok).toBe(true);
    expect(checkBash("env --split-string='cat' .env.example").ok).toBe(true);
  });
  it('allow safe cmd', () => expect(checkBash('ls -la && grep foo bar').ok).toBe(true));
  it('block write to .env', async () => expect((await checkWritePath('.env')).ok).toBe(false));
  it('block write inside .git', async () => expect((await checkWritePath('repo/.git/config')).ok).toBe(false));
  it('block write inside .sanook', async () => expect((await checkWritePath('.sanook/hooks.json')).ok).toBe(false));
  it('block write inside node_modules', async () => expect((await checkWritePath('node_modules/x/y.js')).ok).toBe(false));
  it('allow normal path', async () => expect((await checkWritePath('src/foo.ts')).ok).toBe(true));
  it('block read outside workspace by default', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'sanook-outside-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'nope');
      expect((await checkReadPath(join(outside, 'secret.txt'))).ok).toBe(false);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe('editFileTool (integration)', () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
    dir = await mkdtemp(join(tmpdir(), 'sanook-'));
    file = join(dir, 'f.ts');
    await writeFile(file, 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('แก้สำเร็จเมื่อ old_string unique + เนื้อหารอบข้างคงเดิม', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: 'const b = 2;', new_string: 'const b = 99;' }, opts);
    expect(out).toMatch(/OK/);
    expect(await readFile(file, 'utf8')).toBe('const a = 1;\nconst b = 99;\nconst c = 3;\n');
  });
  it('ERROR เมื่อไม่เจอ old_string (self-heal hint)', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: 'const z = 0;', new_string: 'x' }, opts);
    expect(out).toMatch(/ERROR.*ไม่พบ/);
  });
  it('ERROR เมื่อ ambiguous (พบ >1)', async () => {
    await writeFile(file, 'x();\nx();\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'x();', new_string: 'y();' }, opts);
    expect(out).toMatch(/พบ 2/);
  });
  it('ERROR เมื่อ old_string === new_string', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: 'const a = 1;', new_string: 'const a = 1;' }, opts);
    expect(out).toMatch(/ERROR/);
  });
  it('BLOCKED เมื่อแก้ path ที่ป้องกัน (.env)', async () => {
    const out = await editFileTool.execute!({ path: '.env', old_string: 'a', new_string: 'b' }, opts);
    expect(out).toMatch(/BLOCKED/);
  });
  it('ERROR เมื่อ old_string ว่าง (กัน infinite loop / CLI แฮงค์)', async () => {
    const out = await editFileTool.execute!({ path: file, old_string: '', new_string: 'x' }, opts);
    expect(out).toMatch(/ERROR/);
  });
  it('แก้ไฟล์ CRLF โดยไม่ทำลาย line ending', async () => {
    const f = join(dir, 'crlf.ts');
    await writeFile(f, 'a();\r\nb();\r\nc();\r\n');
    const out = await editFileTool.execute!({ path: f, old_string: 'b();', new_string: 'B();' }, opts);
    expect(out).toMatch(/OK/);
    expect(await readFile(f, 'utf8')).toBe('a();\r\nB();\r\nc();\r\n');
  });

  it('แก้ไฟล์ CR โดยไม่ทำลาย line ending', async () => {
    const f = join(dir, 'cr.ts');
    await writeFile(f, 'a();\rb();\rc();\r');
    const out = await editFileTool.execute!({ path: f, old_string: 'b();', new_string: 'B();' }, opts);
    expect(out).toMatch(/OK/);
    expect(await readFile(f, 'utf8')).toBe('a();\rB();\rc();\r');
  });

  it('flex match (indent ต่าง) → คง indentation เดิม ไม่ de-indent code', async () => {
    const f = join(dir, 'indent.ts');
    await writeFile(f, 'function g() {\n    const x = 1;\n    const y = 2;\n}\n');
    // model ส่ง old/new แบบไม่มี indent → flex tier match แต่ต้อง re-apply 4-space indent ของไฟล์
    const out = await editFileTool.execute!(
      { path: f, old_string: 'const x = 1;\nconst y = 2;', new_string: 'const x = 10;\nconst y = 20;' },
      opts,
    );
    expect(out).toMatch(/OK/);
    expect(await readFile(f, 'utf8')).toBe('function g() {\n    const x = 10;\n    const y = 20;\n}\n');
  });

  it('replace_all: แทนที่ทุกที่ด้วย old_string สั้นๆ (rename) — ไม่ต้อง unique, ประหยัด token', async () => {
    await writeFile(file, 'let total = 0;\ntotal = total + 1;\nreturn total;\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'total', new_string: 'sum', replace_all: true }, opts);
    expect(out).toMatch(/OK/);
    expect(out).toMatch(/4 ที่/); // 4 occurrences replaced
    expect(await readFile(file, 'utf8')).toBe('let sum = 0;\nsum = sum + 1;\nreturn sum;\n');
  });

  it('replace_all: ไม่เจอ → ERROR (match ตรงเป๊ะเท่านั้น)', async () => {
    await writeFile(file, 'const a = 1;\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'zzz', new_string: 'y', replace_all: true }, opts);
    expect(out).toMatch(/ERROR.*ไม่พบ/);
  });

  it('ambiguous (ไม่มี replace_all) → ERROR แนะนำ replace_all', async () => {
    await writeFile(file, 'x();\nx();\n');
    const out = await editFileTool.execute!({ path: file, old_string: 'x();', new_string: 'y();' }, opts);
    expect(out).toMatch(/พบ 2/);
    expect(out).toMatch(/replace_all/); // suggest the token-cheap path instead of padding context
  });
});

describe('write / read / list tools', () => {
  let dir: string;
  beforeEach(async () => {
    vi.stubEnv('SANOOK_ALLOW_OUTSIDE_WORKSPACE', '1');
    dir = await mkdtemp(join(tmpdir(), 'sanook-'));
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(dir, { recursive: true, force: true });
  });

  it('write สร้างไฟล์ (mkdir recursive) + read อ่านกลับได้', async () => {
    const f = join(dir, 'a/b/new.txt');
    expect(await writeFileTool.execute!({ path: f, content: 'hello' }, opts)).toMatch(/OK/);
    expect(await readFileTool.execute!({ path: f }, opts)).toBe('hello');
  });
  it('write block protected path', async () => {
    const out = await writeFileTool.execute!({ path: join(dir, '.git/x'), content: 'x' }, opts);
    expect(out).toMatch(/BLOCKED/);
  });
  it('read คืน ERROR (ไม่ throw) เมื่อไฟล์ไม่มี', async () => {
    expect(await readFileTool.execute!({ path: join(dir, 'nope.txt') }, opts)).toMatch(/ERROR/);
  });
  it('read full file normalizes carriage-return line endings for display', async () => {
    const f = join(dir, 'full-cr.txt');
    await writeFile(f, 'L1\rL2\r\nL3\r');

    const out = String(await readFileTool.execute!({ path: f }, opts));

    expect(out).toBe('L1\nL2\nL3\n');
    expect(out).not.toContain('\r');
  });
  it('read offset/limit อ่านเฉพาะช่วงบรรทัด (ประหยัด token)', async () => {
    const f = join(dir, 'big.txt');
    await writeFile(f, 'L1\nL2\nL3\nL4\nL5\n');
    const out = String(await readFileTool.execute!({ path: f, offset: 2, limit: 2 }, opts));
    expect(out).toContain('[บรรทัด 2-3'); // header กำกับช่วง
    expect(out).toContain('L2\nL3');
    expect(out).not.toContain('L1');
    expect(out).not.toContain('L5');
  });
  it('read offset/limit strips CRLF carriage returns from ranged output', async () => {
    const f = join(dir, 'crlf.txt');
    await writeFile(f, 'L1\r\nL2\r\nL3\r\n');

    const out = String(await readFileTool.execute!({ path: f, offset: 2, limit: 2 }, opts));

    expect(out).toContain('L2\nL3');
    expect(out).not.toContain('\r');
  });
  it('read offset/limit handles bare carriage-return line endings', async () => {
    const f = join(dir, 'cr.txt');
    await writeFile(f, 'L1\rL2\rL3\r');

    const out = String(await readFileTool.execute!({ path: f, offset: 2, limit: 2 }, opts));

    expect(out).toContain('[บรรทัด 2-3 จาก 3]');
    expect(out).toContain('L2\nL3');
    expect(out).not.toContain('\r');
  });
  it('read offset เกินช่วง → บอกชัด ไม่ throw', async () => {
    const f = join(dir, 'small.txt');
    await writeFile(f, 'only\n');
    expect(String(await readFileTool.execute!({ path: f, offset: 99 }, opts))).toContain('เกินช่วง');
  });
  it('read offset does not expose a phantom line after a trailing newline', async () => {
    const f = join(dir, 'trailing-newline.txt');
    await writeFile(f, 'only\n');

    const out = String(await readFileTool.execute!({ path: f, offset: 2 }, opts));

    expect(out).toContain('เกินช่วง');
    expect(out).toContain('ไฟล์มี 1 บรรทัด');
  });
  it('read limit-only range reports the default offset for empty files', async () => {
    const f = join(dir, 'empty.txt');
    await writeFile(f, '');

    const out = String(await readFileTool.execute!({ path: f, limit: 1 }, opts));

    expect(out).toContain('offset 1 เกินช่วง');
    expect(out).not.toContain('undefined');
  });
  it('list คืนชื่อไฟล์ในโฟลเดอร์', async () => {
    await writeFile(join(dir, 'a.txt'), '');
    expect(await listDirTool.execute!({ path: dir }, opts)).toContain('a.txt');
  });
  it('list filters protected child paths', async () => {
    await writeFile(join(dir, 'safe.txt'), '');
    await writeFile(join(dir, '.env'), 'SECRET=x');
    await writeFile(join(dir, '.env.example'), 'SAFE=x');
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });

    const out = String(await listDirTool.execute!({ path: dir }, opts));

    expect(out).toContain('safe.txt');
    expect(out).toContain('.env.example');
    expect(out).not.toContain('node_modules');
    expect(out).not.toMatch(/(^|\n)\.env($|\n)/);
  });
  it('list filters symlinks that resolve to protected paths', async () => {
    await writeFile(join(dir, 'safe.txt'), '');
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'secret');
    try {
      await symlink(join(dir, 'node_modules', 'pkg', 'index.js'), join(dir, 'linked-secret.js'));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return;
      throw err;
    }

    const out = String(await listDirTool.execute!({ path: dir }, opts));

    expect(out).toContain('safe.txt');
    expect(out).not.toContain('linked-secret.js');
  });
  it('list marks allowed directory symlinks as directories', async () => {
    await mkdir(join(dir, 'target'), { recursive: true });
    try {
      await symlink(join(dir, 'target'), join(dir, 'target-link'));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return;
      throw err;
    }

    const out = String(await listDirTool.execute!({ path: dir }, opts));

    expect(out).toContain('target/');
    expect(out).toContain('target-link/');
  });
  it('glob block traversal/absolute pattern แม้ cwd อยู่ใน workspace', async () => {
    expect(await globTool.execute!({ pattern: '../*', cwd: '.' }, opts)).toMatch(/BLOCKED/);
    expect(await globTool.execute!({ pattern: '/tmp/*', cwd: '.' }, opts)).toMatch(/BLOCKED/);
  });
  it('glob filters protected paths even when explicitly matched', async () => {
    await mkdir(join(dir, '.git'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, '.git', 'config'), 'secret');
    await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'secret');
    await writeFile(join(dir, '.env'), 'SECRET=x');
    await writeFile(join(dir, '.env.example'), 'SAFE=x');

    const envOut = String(await globTool.execute!({ pattern: '.env*', cwd: dir }, opts));
    expect(envOut).toContain('.env.example');
    expect(envOut).not.toMatch(/(^|\n)\.env($|\n)/);
    expect(await globTool.execute!({ pattern: '.git/**', cwd: dir }, opts)).toBe('(no matches)');
    expect(await globTool.execute!({ pattern: 'node_modules/**', cwd: dir }, opts)).toBe('(no matches)');
  });
  it('glob filters symlinks that resolve to protected paths', async () => {
    await writeFile(join(dir, 'safe.js'), '');
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'secret');
    try {
      await symlink(join(dir, 'node_modules', 'pkg', 'index.js'), join(dir, 'linked-secret.js'));
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'ENOTSUP') return;
      throw err;
    }

    const out = String(await globTool.execute!({ pattern: '**/*.js', cwd: dir }, opts));

    expect(out).toContain('safe.js');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('linked-secret.js');
  });
  it('glob does not count protected matches toward truncation', async () => {
    for (let i = 0; i < 200; i += 1) {
      await writeFile(join(dir, `allowed-${String(i).padStart(3, '0')}.js`), '');
    }
    await mkdir(join(dir, 'node_modules', 'pkg'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'pkg', 'index.js'), 'secret');

    const out = String(await globTool.execute!({ pattern: '**/*.js', cwd: dir }, opts));

    expect(out.split('\n')).toHaveLength(200);
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('truncated');
  });
  it('glob only reports truncation when matches exceed the result cap', async () => {
    for (let i = 0; i < 200; i += 1) {
      await writeFile(join(dir, `many-${String(i).padStart(3, '0')}.txt`), '');
    }

    const exactCap = String(await globTool.execute!({ pattern: 'many-*.txt', cwd: dir }, opts)).split('\n');
    expect(exactCap).toHaveLength(200);
    expect(exactCap.at(-1)).toBe('many-199.txt');
    expect(exactCap.some((line) => line.includes('truncated'))).toBe(false);

    await writeFile(join(dir, 'many-200.txt'), '');

    const overCap = String(await globTool.execute!({ pattern: 'many-*.txt', cwd: dir }, opts)).split('\n');
    expect(overCap).toHaveLength(201);
    expect(overCap.at(-1)).toBe('... [>200 matches, truncated]');
  });
});
