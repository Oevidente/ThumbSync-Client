const fs = require('fs');
let app = fs.readFileSync('app.js', 'utf8');

const regex = /\$\{emersonAccounts\.length > 0 \? `[\s\S]*?` \: `[\s\S]*?`\}/;
console.log('Match:', regex.test(app));

const replacement = `<div class="flex flex-wrap gap-1.5">
                    <span class="text-[10px] font-mono bg-white/5 text-zinc-300 border border-white/10 px-2 py-0.5 rounded-lg \${profile.email && profile.email.toLowerCase() === 'emerson@betdasorte.com' ? 'border-blue-500/50 text-blue-300 font-bold bg-blue-500/10' : ''}">emerson@betdasorte.com</span>
                    \${emersonAccounts.filter(e => e.toLowerCase() !== 'emerson@betdasorte.com' && !this.getAdminAccounts().map(a => a.toLowerCase()).includes(e.toLowerCase())).map(email => \`
                      <span class="text-[10px] font-mono bg-white/5 text-zinc-300 border border-white/10 px-2 py-0.5 rounded-lg \${profile.email && profile.email.toLowerCase() === email.toLowerCase() ? 'border-blue-500/50 text-blue-300 font-bold bg-blue-500/10' : ''}">\${email}</span>
                    \`).join('')}
                  </div>`;

app = app.replace(regex, replacement);
fs.writeFileSync('app.js', app);
console.log('patched again');
