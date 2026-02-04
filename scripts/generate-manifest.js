const fs = require('fs');
const path = require('path');

const examplesDir = path.join(__dirname, '..', 'examples');
const outputPath = path.join(examplesDir, 'manifest.json');

const examples = [];

for (const folder of fs.readdirSync(examplesDir)) {
  const folderPath = path.join(examplesDir, folder);
  if (!fs.statSync(folderPath).isDirectory()) continue;
  
  // Try package.json first (JS/TS projects)
  const packageJsonPath = path.join(folderPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    const example = {
      name: folder,
      displayName: pkg.displayName || pkg.name || folder,
      description: pkg.description || ''
    };
    // Include setup instructions if provided
    if (pkg.setup && Array.isArray(pkg.setup)) {
      example.setup = pkg.setup;
    }
    examples.push(example);
    continue;
  }
  
  // Try pyproject.toml (Python projects)
  const pyprojectPath = path.join(folderPath, 'pyproject.toml');
  if (fs.existsSync(pyprojectPath)) {
    const content = fs.readFileSync(pyprojectPath, 'utf-8');
    const nameMatch = content.match(/^name\s*=\s*"([^"]+)"/m);
    const descMatch = content.match(/^description\s*=\s*"([^"]+)"/m);
    
    const example = {
      name: folder,
      displayName: nameMatch?.[1] || folder,
      description: descMatch?.[1] || ''
    };
    
    // Parse setup array from pyproject.toml if present
    // Format: setup = ["cmd1", "cmd2"]
    const setupMatch = content.match(/^setup\s*=\s*\[([\s\S]*?)\]/m);
    if (setupMatch) {
      const setupStr = setupMatch[1];
      const cmds = setupStr.match(/"([^"]+)"/g);
      if (cmds) {
        example.setup = cmds.map(s => s.replace(/"/g, ''));
      }
    }
    
    examples.push(example);
    continue;
  }
  
  // Folder exists but no metadata file, include with defaults
  examples.push({
    name: folder,
    displayName: folder,
    description: ''
  });
}

// Sort alphabetically
examples.sort((a, b) => a.name.localeCompare(b.name));

const manifest = {
  version: 1,
  generated: new Date().toISOString(),
  examples
};

fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Generated manifest with ${examples.length} examples`);
