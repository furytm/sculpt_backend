// Runs on your computer everything the pull request check runs, one after another, and shows every problem together.
//
//   pnpm verify           the injected-code check, lint, typecheck, tests and a full build   (npm run verify / yarn verify also work)
//   pnpm verify --quick   the same without the build (this is what runs before every push)
//
// It carries on after a failure, so you fix everything in one go instead of one problem per push.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const quick = process.argv.includes('--quick');
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const has = (name) => Boolean(pkg.scripts?.[name]);
const pm = existsSync('pnpm-lock.yaml') ? 'pnpm' : existsSync('yarn.lock') ? 'yarn' : 'npm';
const script = (name) => (pm === 'npm' ? `npm run ${name}` : `${pm} ${name}`);
const exec = (command) => (pm === 'pnpm' ? `pnpm exec ${command}` : pm === 'yarn' ? `yarn ${command}` : `npx ${command}`);
const steps = [
  ['Injected code check', 'node scripts/check-injected-code.mjs', 'Do not run this project. Compare package.json and the config files with main, and tell the admin.'],
  has('lint') && ['Lint', script('lint'), `Run ${script('lint')} -- --fix (or fix each problem listed above).`],
  has('typecheck') ? ['Typecheck', script('typecheck'), 'Fix each type error listed above.'] : existsSync('tsconfig.json') && ['Typecheck', exec('tsc --noEmit'), 'Fix each type error listed above.'],
  has('test') && ['Tests', script('test'), 'Fix each failing test listed above.'],
  !quick && has('build') && ['Build', script('build'), 'Fix the error the build prints. It fails the same way when we deploy.'],
].filter(Boolean);

const failed = [];
for (const [name, command] of steps) {
  console.log(`\n=== ${name}: ${command}`);
  const result = spawnSync(command, { shell: true, stdio: 'inherit' });
  if (result.status !== 0) failed.push(name);
}

console.log('\n=== Summary');
for (const [name] of steps) console.log(`${failed.includes(name) ? 'FAILED' : 'ok    '}  ${name}`);
if (failed.length) {
  console.log('\nWhat to do:');
  for (const [name, , hint] of steps) if (failed.includes(name)) console.log(`- ${name}: ${hint}`);
  process.exit(1);
}
console.log(quick ? '\nEverything checked passed. Run the verify script without --quick to include the build.' : '\nEverything passed.');
