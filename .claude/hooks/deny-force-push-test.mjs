// node .claude/hooks/deny-force-push-test.mjs — runs the hook as Claude Code does: JSON on stdin, exit code checked.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const hook = fileURLToPath(new URL('./deny-force-push.mjs', import.meta.url));

const blocked = [
  'git push --force origin main',
  'git push origin main --force',
  'git push --force-with-lease origin main',
  'git push --force-with-lease=main:abc origin main',
  'git push --force-if-includes --force-with-lease origin main',
  'git push --mirror origin',
  'git push --forc origin main',
  'git push -f origin main',
  'git push -uf origin x',
  'git push -fu origin x',
  'git push -qf origin x',
  'git push -vuf origin x',
  'git push origin +main',
  'git push origin +HEAD:main',
  'git push origin main -- +other',
  'git -C path push -f',
  'git -C path push -uf origin x',
  'git -c a=b push origin +main',
  'git --no-pager --git-dir=.git push --force',
  'git --work-tree=/tmp push -f origin x',
  'git -c remote.origin.mirror=true push origin',
  '/usr/bin/git push -f origin main',
  'FOO=1 BAR=2 git push -f origin main',
  'env GIT_TRACE=1 git push -f origin main',
  'env -i PATH=/bin git push --force origin main',
  'command git push -f origin main',
  'npm test && git push -f origin main',
  'false || git push -uf origin x',
  'echo ok; git push origin +main',
  'echo ok | git push --mirror origin',
  'echo ok\ngit push -f origin main',
  "sh -c 'git push -f origin main'",
  'bash -c "git push -uf origin x"',
  'bash -lc "cd app && git push origin +main"',
  "sh -c 'bash -c \"git push --force origin main\"'",
  'eval "git push -f origin main"',
  'echo $(git push -f origin main)',
  'git push \\\n  -f origin main',
];

const allowed = [
  'git push',
  'git push origin main',
  'git push -u origin feat-fix',
  'git push -q origin main',
  'git push -uq origin main',
  'git -C path push origin main',
  'git -C path push -u origin main',
  'git push origin feat-fix',
  'git push origin feat-fix:feat-fix',
  'git push -o ci.skip origin main',
  'git push -of origin main',
  'git push --follow-tags origin main',
  'git push --no-force-with-lease origin main',
  'git push -d origin old-branch',
  'git fetch -f origin',
  'git fetch origin +refs/heads/*:refs/remotes/origin/*',
  'git commit -m "push -f"',
  'git commit -m "git push -f origin main"',
  'echo "git push -f"',
  'git log --oneline -5',
  'git -c user.name=x commit -m msg',
  'gh pr create --title "no force push"',
  'sh scripts/push.sh -f',
  '',
];

let failures = 0;
const run = (command) => spawnSync(process.execPath, [hook], {
  input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } }),
  encoding: 'utf8',
});
for (const [cases, expected] of [[blocked, 2], [allowed, 0]]) {
  for (const command of cases) {
    const result = run(command);
    const ok = result.status === expected && (expected === 0 || result.stderr.includes('Force-push is forbidden'));
    if (!ok) { failures++; console.log(`FAIL expected ${expected}, got ${result.status}: ${JSON.stringify(command)} ${result.stderr}`); }
  }
}
const total = blocked.length + allowed.length;
console.log(`${total - failures}/${total} hook cases passed (${blocked.length} blocked, ${allowed.length} allowed)`);
if (failures) process.exitCode = 1;
