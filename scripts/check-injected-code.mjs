#!/usr/bin/env node
// The one trusted check that decides whether a source tree may be uploaded, built or run.
//
// It lives here, outside every project, because a project cannot be trusted to judge itself: the trojan
// edits package.json, and with it the order of the scripts and the check inside them (on 8 Nov 2026 a preview
// build ran `node init && node scripts/check-injected-code.mjs`, so the virus ran and the check failed
// afterwards). This script only reads text. It runs nothing from the tree it is given and needs no packages.
//
//   node gate.mjs [directory]
//
// Hard findings stop everything (exit 1). Warnings never stop anything; they print plain advice.
import { readdirSync, readFileSync, statSync, existsSync, appendFileSync } from 'node:fs';
import { join, extname, relative, basename, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_LINE = 2000;
const SKIP_DIRS = new Set(['node_modules', '.next', '.git', '.vercel', 'dist', 'build', 'coverage', 'out', '.turbo', '.venv', 'venv', '__pycache__']);
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.tsx', '.jsx']);
const BINARY_MAGIC = [
  Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('GIF8'), Buffer.from('OTTO'),
  Buffer.from([0x00, 0x01, 0x00, 0x00]), Buffer.from('wOFF'), Buffer.from('wOF2'), Buffer.from('%PDF'),
];
const CLAIMS_BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ttf', '.otf', '.woff', '.woff2', '.pdf', '.ico']);

/** File names that have no business in any project of ours. Matched at the project root, except *.lfk which is matched anywhere. */
const ROOT_BAD = new Set(['init', 'api.js', 'temp_auto_push.bat', 'config.bat']);
/** A config file is code that runs when the tool starts. */
const isConfig = (rel) => {
  const name = basename(rel);
  return /\.config\.(c|m)?(js|ts)$/.test(name) || /^\.?(eslintrc|babelrc|prettierrc)(\.(c|m)?js)?$/.test(name) || /^tsconfig[^/]*\.json$/.test(name) || /^(postcss|tailwind|next|vite|vitest|jest|eslint|webpack|rollup)\.[a-z.]*(js|ts)$/.test(name);
};
/** Things that mean "this long line is a payload", not "this long line is page markup". */
const VIRUS_SIGNS = [
  [/global\s*\[\s*['"]!['"]\s*\]/, "global['!'] (the trojan's marker)"],
  [/\beval\s*\(/, 'eval('],
  [/\bnew\s+Function\s*\(/, 'new Function('],
  [/\bchild_process\b/, 'child_process'],
  [/(?:\\x[0-9a-fA-F]{2}){12,}/, 'a long run of \\x escapes'],
  [/\batob\s*\(/, 'atob('],
  [/fromCharCode/, 'fromCharCode'],
  [/_\$_[0-9a-f]{4}/, 'obfuscator names (_$_xxxx)'],
];
const PKG_BAD = [
  [/\bnode\s+(?:\.\/)?(?:init|api\.js)\b/, 'runs the trojan file with node'],
  [/\.lfk\b/, 'refers to a .lfk file'],
  [/\b(?:curl|wget)\b[^|;&]*\|\s*(?:sh|bash|node)\b/, 'downloads and runs something'],
  [/\bpowershell\b[^;&]*-(?:enc|encodedcommand)\b/i, 'runs an encoded PowerShell command'],
  [/\bbase64\s+(?:-d|--decode)\b/, 'decodes base64 and runs it'],
];

/** Unusual but not proof of anything: reported as a warning, and the review hold (preview-deploy.yml) makes a person read it. */
const PKG_WARN = [[/\bnode\s+(?:\.\/)?[A-Za-z0-9_-]+(?=\s|&|;|\||$)/, 'runs a file with no extension with node']];

function* walk(dir, root) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) yield* walk(full, root);
    } else {
      yield full;
    }
  }
}

export function scan(root) {
  const hard = [];
  const warn = [];
  const add = (list, file, line, why, advice) => list.push({ file, line, why, advice });

  for (const full of walk(root)) {
    const rel = relative(root, full).split(sep).join('/');
    const name = basename(rel);
    if (!rel.includes('/') && ROOT_BAD.has(name)) {
      add(hard, rel, 0, `a root file named "${name}" that none of our projects use`, 'It was added by the virus. Delete it.');
    }
    if (name.endsWith('.lfk')) add(hard, rel, 0, 'a .lfk file', 'The virus hides in files with this extension.');

    if (rel === 'package.json') {
      let pkg = null;
      try { pkg = JSON.parse(readFileSync(full, 'utf8')); } catch { /* not valid JSON: leave it to the build to complain */ }
      for (const [key, value] of Object.entries(pkg?.scripts ?? {})) {
        if (typeof value !== 'string') continue;
        for (const [re, what] of PKG_BAD) {
          if (re.test(value)) add(hard, 'package.json', 0, `script "${key}" ${what}: ${value.slice(0, 100)}`, 'Put the script back the way it was in main.');
        }
        for (const [re, what] of PKG_WARN) {
          if (re.test(value)) add(warn, 'package.json', 0, `script "${key}" ${what}: ${value.slice(0, 100)}`, 'If you added this, fine. If you did not, compare the script with main.');
        }
      }
    }

    const ext = extname(name);
    if (!CODE_EXT.has(ext) && !isConfig(rel)) continue;
    if (name.includes('.min.') || name.endsWith('-lock.json')) continue;
    let text;
    try { text = readFileSync(full, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      if (line.length <= MAX_LINE) return;
      if (isConfig(rel) || !rel.includes('/')) {
        add(hard, rel, i + 1, `a ${line.length} character line in a config or root file`, 'Config files are short. Compare with main and remove the extra line.');
        return;
      }
      const sign = VIRUS_SIGNS.find(([re]) => re.test(line));
      if (sign) {
        add(hard, rel, i + 1, `a ${line.length} character line containing ${sign[1]}`, 'This does not look typed. Do not run this branch.');
      } else {
        add(warn, rel, i + 1, `a ${line.length} character line`, 'If you wrote this, split it onto several lines or run: npx prettier --write ' + rel + '. If you did not write it, stop and tell the admin.');
      }
    });
  }

  // The trojan rewrites .gitignore and drops the lines that keep .env files out of Git (seen in 11 branches on 9 Nov 2026, and in a
  // pull request that deleted them by hand the next day). A repository whose .gitignore does not ignore .env is not allowed to ship.
  const gi = join(root, '.gitignore');
  if (existsSync(gi)) {
    const rules = readFileSync(gi, 'utf8').split('\n').map((l) => l.trim());
    if (!rules.some((l) => /^\/?\.env(\*|\.\*|\.local)?$/.test(l) || l === '*.env')) {
      add(hard, '.gitignore', 0, 'it no longer ignores .env files', 'Put back the lines `.env` and `.env.*` (and `!.env.example` if you keep an example).');
    }
  } else {
    add(warn, '.gitignore', 0, 'there is no .gitignore at the project root', 'Add one before the first commit. It must ignore .env files and node_modules.');
  }

  const tasks = join(root, '.vscode', 'tasks.json');
  if (existsSync(tasks)) {
    let json = null;
    try { json = JSON.parse(readFileSync(tasks, 'utf8')); } catch { /* ignore */ }
    for (const task of json?.tasks ?? []) {
      if (task.runOptions?.runOn === 'folderOpen') {
        add(hard, '.vscode/tasks.json', 0, `task "${task.label ?? '(unlabeled)'}" runs by itself when the folder is opened`, 'Delete the task.');
      }
      const refs = [task.command, ...(Array.isArray(task.args) ? task.args : [])].filter((v) => typeof v === 'string').flatMap((v) => v.match(/[.\/\w-]+\.(png|jpg|jpeg|gif|webp|ttf|otf|woff2?|pdf|ico)/gi) ?? []);
      for (const ref of refs) {
        const candidate = join(root, ref.replace(/^\.\//, ''));
        if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
        const e = extname(candidate).toLowerCase();
        if (!CLAIMS_BINARY.has(e)) continue;
        const head = readFileSync(candidate).subarray(0, 8);
        if (!BINARY_MAGIC.some((m) => head.subarray(0, m.length).equals(m))) {
          add(hard, relative(root, candidate).split(sep).join('/'), 0, `named like ${e} but its content is not that format, and .vscode/tasks.json refers to it`, 'Delete it.');
        }
      }
    }
  }
  return { hard, warn };
}

function report({ hard, warn }) {
  const gha = process.env.GITHUB_ACTIONS === 'true';
  const summary = [];
  for (const f of warn) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    console.log(gha ? `::warning file=${f.file}${f.line ? `,line=${f.line}` : ''},title=Long line (warning only)::${f.why}. ${f.advice}` : `warning  ${where}  ${f.why}. ${f.advice}`);
    summary.push(`- warning: \`${where}\` ${f.why}. ${f.advice}`);
  }
  for (const f of hard) {
    const where = f.line ? `${f.file}:${f.line}` : f.file;
    console.error(gha ? `::error file=${f.file}${f.line ? `,line=${f.line}` : ''},title=Stopped before anything ran::${f.why}. ${f.advice}` : `BLOCKED  ${where}  ${f.why}. ${f.advice}`);
    summary.push(`- BLOCKED: \`${where}\` ${f.why}. ${f.advice}`);
  }
  if (hard.length) {
    console.error('\nNothing was uploaded, built or run. This check found something that does not look typed by a person.\n'
      + 'If you did not write it: stop, do not run this branch on your computer, and tell the admin.\n'
      + 'If it is real code you wrote: tell the admin what it is, and they will open an exception.');
  } else {
    console.log(`Gate passed: no injected files, no scripts that run unknown files, no oversized config lines${warn.length ? `, ${warn.length} long line(s) to tidy (warning only)` : ''}.`);
  }
  if (process.env.GITHUB_STEP_SUMMARY && summary.length) {
    try { appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Injected code gate\n${summary.join('\n')}\n`); } catch { /* not fatal */ }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = scan(process.argv[2] ?? process.cwd());
  report(result);
  process.exit(result.hard.length ? 1 : 0);
}
