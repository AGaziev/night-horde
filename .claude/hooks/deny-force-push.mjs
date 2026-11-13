#!/usr/bin/env node
// PreToolUse hook for Bash: blocks every form of git force-push. Exit 2 blocks the call.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEPARATORS = new Set([';', '&', '|', '\n', '(', ')', '`']);
const WRAPPERS = new Set(['command', 'exec', 'nohup', 'time', 'builtin', 'sudo', 'doas']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
const GIT_GLOBAL_WITH_ARG = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix', '--config-env', '--exec-path', '--list-cmds', '--attr-source']);
const FORBIDDEN_LONG = ['force', 'force-with-lease', 'force-if-includes', 'mirror'];
const PUSH_LONG_WITH_ARG = new Set(['--repo', '--receive-pack', '--exec', '--push-option', '--recurse-submodules', '--signed']);

export function splitCommands(text) {
  const segments = [];
  let words = [], word = '', inWord = false, quote = null;
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endSegment = () => { endWord(); if (words.length) segments.push(words); words = []; };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") { if (ch === "'") quote = null; else word += ch; continue; }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else if (ch === '\\' && i + 1 < text.length && '"\\$`\n'.includes(text[i + 1])) { if (text[++i] !== '\n') word += text[i]; }
      else word += ch;
      continue;
    }
    if (ch === '\\') { if (i + 1 < text.length) { i++; if (text[i] !== '\n') { word += text[i]; inWord = true; } } continue; }
    if (ch === "'" || ch === '"') { quote = ch; inWord = true; continue; }
    if (ch === '$' && text[i + 1] === '(') { endSegment(); i++; continue; }
    if (SEPARATORS.has(ch)) { endSegment(); continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r') { endWord(); continue; }
    word += ch; inWord = true;
  }
  endSegment();
  return segments;
}

const baseName = (word) => word.slice(word.lastIndexOf('/') + 1);
const isAssignment = (word) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);

function skipEnv(words, i) {
  for (i++; i < words.length; i++) {
    const w = words[i];
    if (w === '--') return i + 1;
    if (w === '-u' || w === '-C' || w === '-S' || w === '--unset' || w === '--chdir' || w === '--split-string') { i++; continue; }
    if (w.startsWith('-') || isAssignment(w)) continue;
    return i;
  }
  return i;
}

function shellScript(words, i) {
  let sawC = false;
  for (i++; i < words.length; i++) {
    const w = words[i];
    if (w === '--') { i++; break; }
    if (/^[-+]o$/.test(w)) { i++; continue; }
    if (w.startsWith('--')) continue;
    if (/^[-+][A-Za-z]+$/.test(w)) { if (w.slice(1).includes('c')) sawC = true; continue; }
    break;
  }
  return sawC && i < words.length ? words[i] : null;
}

function forbiddenLong(option) {
  const name = option.slice(2).split('=')[0];
  return name.length > 0 && FORBIDDEN_LONG.some((forbidden) => forbidden.startsWith(name));
}

function pushReason(args) {
  let positional = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!positional && a === '--') { positional = true; continue; }
    if (!positional && a.startsWith('--')) {
      if (forbiddenLong(a)) return `option ${a}`;
      if (!a.includes('=') && PUSH_LONG_WITH_ARG.has(a)) i++;
      continue;
    }
    if (!positional && a.startsWith('-') && a.length > 1) {
      for (let k = 1; k < a.length; k++) {
        if (a[k] === 'f') return `short option cluster ${a}`;
        if (a[k] === 'o') { if (k === a.length - 1) i++; break; }
      }
      continue;
    }
    if (a.startsWith('+')) return `forced refspec ${a}`;
  }
  return null;
}

function gitReason(words, i) {
  const configs = [];
  for (i++; i < words.length; i++) {
    const w = words[i];
    if (!w.startsWith('-')) break;
    if (GIT_GLOBAL_WITH_ARG.has(w)) { if (w === '-c') configs.push(words[i + 1] ?? ''); i++; }
  }
  if (words[i] !== 'push') return null;
  const forcedConfig = configs.find((c) => /^remote\..+\.(push|mirror)=/i.test(c));
  if (forcedConfig) return `config ${forcedConfig}`;
  return pushReason(words.slice(i + 1));
}

function segmentReason(words, depth) {
  let i = 0;
  while (i < words.length) {
    const w = words[i], name = baseName(w);
    if (isAssignment(w)) { i++; continue; }
    if (name === 'env') { i = skipEnv(words, i); continue; }
    if (WRAPPERS.has(name)) { i++; while (i < words.length && words[i].startsWith('-')) i++; continue; }
    if (name === 'eval') return commandReason(words.slice(i + 1).join(' '), depth + 1);
    if (SHELLS.has(name)) { const script = shellScript(words, i); return script === null ? null : commandReason(script, depth + 1); }
    if (name === 'git') return gitReason(words, i);
    return null;
  }
  return null;
}

export function commandReason(command, depth = 0) {
  if (typeof command !== 'string' || depth > 8) return null;
  for (const words of splitCommands(command)) {
    const reason = segmentReason(words, depth);
    if (reason) return reason;
  }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { process.exit(0); }
  const reason = commandReason(input?.tool_input?.command);
  if (reason) {
    process.stderr.write(`Force-push is forbidden in this repository (${reason}). Push without force or ask the owner.\n`);
    process.exit(2);
  }
  process.exit(0);
}
