const { execSync } = require('child_process');
const crypto = require('crypto');
const sh = (c) => execSync(c, { encoding: 'buffer', maxBuffer: 1e8 });
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const names = [
  '20261022145205_add_guest_membership_contact_fields',
  '20261022150000_guest_membership_purchase_fields',
];

console.log('=== _prisma_migrations ===');
console.log(sh(`psql -U postgres -h localhost -d sculpt_lab -c "SELECT migration_name, checksum, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at"`).toString());

for (const n of names) {
  const p = `prisma/migrations/${n}/migration.sql`;
  console.log(`\n=== ${n} ===`);
  const cur = require('fs').readFileSync(p);
  console.log('working file      :', sha(cur));
  const commits = sh(`git log --format=%h -- ${p}`).toString().trim().split(/\s+/);
  for (const c of commits) {
    const blob = sh(`git show ${c}:${p}`);
    const crlf = Buffer.from(blob.toString().replace(/\r?\n/g, '\r\n'));
    console.log(`commit ${c} LF  :`, sha(blob));
    console.log(`commit ${c} CRLF:`, sha(crlf));
  }
}

console.log('\n=== live schema vs schema.prisma (empty output = no drift) ===');