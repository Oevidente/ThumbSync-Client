const fs = require('fs');

const rules = JSON.parse(fs.readFileSync('keyword_rules.json', 'utf8'));

// Add Amusnet rules
rules.specialRules.push({
  "ifProvider": "amusnet",
  "ifNameIncludes": ["roulette", "keno", "dice", "sic bo", "blackjack", "baccarat", "poker"],
  "thenCategory": "Mesa RNG"
});
rules.specialRules.push({
  "ifProvider": "amusnet",
  "thenCategory": "Slot"
});

fs.writeFileSync('keyword_rules.json', JSON.stringify(rules, null, 2));
