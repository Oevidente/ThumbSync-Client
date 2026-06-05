const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, 'public', 'fonts');
const fontFiles = fs.readdirSync(fontsDir);

let cssContent = '';

fontFiles.forEach(file => {
  if (file.endsWith('.otf') || file.endsWith('.ttf')) {
    let family = 'SF Pro Default';
    if (file.includes('SF-Pro-Display')) family = 'SF Pro Display';
    else if (file.includes('SF-Pro-Text')) family = 'SF Pro Text';
    else if (file.includes('SF-Pro-Rounded')) family = 'SF Pro Rounded';
    else if (file.includes('SF-Pro')) family = 'SF Pro';
    
    let weight = '400';
    if (file.includes('Ultralight')) weight = '100';
    else if (file.includes('Thin')) weight = '200';
    else if (file.includes('Light')) weight = '300';
    else if (file.includes('Medium')) weight = '500';
    else if (file.includes('Semibold')) weight = '600';
    else if (file.includes('Bold')) weight = '700';
    else if (file.includes('Heavy') || file.includes('Black')) weight = '900';
    
    let style = 'normal';
    if (file.includes('Italic')) style = 'italic';

    cssContent += `
@font-face {
  font-family: '${family}';
  src: url('/fonts/${file}') format('${file.endsWith('.otf') ? 'opentype' : 'truetype'}');
  font-weight: ${weight};
  font-style: ${style};
  font-display: swap;
}
`;
  }
});

// Write to public/fonts.css
fs.writeFileSync(path.join(__dirname, 'public', 'fonts.css'), cssContent);
console.log('fonts.css generated successfully!');
