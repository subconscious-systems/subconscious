#!/usr/bin/env node

import { downloadTemplate } from 'giget';
import prompts from 'prompts';
import pc from 'picocolors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);

const MANIFEST_URL =
  'https://raw.githubusercontent.com/subconscious-systems/subconscious/main/examples/manifest.json';

const REPO_BASE = 'github:subconscious-systems/subconscious/examples';

function parseArgs(args) {
  const result = {
    projectName: null,
    example: null,
    list: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '--version' || arg === '-v') {
      result.version = true;
    } else if (arg === '--list') {
      result.list = true;
    } else if (arg === '--example' || arg === '-e') {
      result.example = args[++i];
    } else if (!arg.startsWith('-') && !result.projectName) {
      result.projectName = arg;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
${pc.bold('create-subconscious-app')} v${packageJson.version}

Create a new Subconscious agent project from examples.

${pc.bold('Usage:')}
  npx create-subconscious-app [project-name] [options]

${pc.bold('Options:')}
  -e, --example <name>  Example to use (skips selection prompt)
  --list                Print available examples and exit
  -h, --help            Show this help message
  -v, --version         Show version number

${pc.bold('Examples:')}
  npx create-subconscious-app                        # interactive
  npx create-subconscious-app my-agent               # prompts for example
  npx create-subconscious-app my-agent -e e2b_cli    # no prompts
  npx create-subconscious-app --list                 # print examples
`);
}

async function fetchManifest() {
  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(
      pc.red('Could not fetch example list. Check your internet connection.')
    );
    process.exit(1);
  }
}

function printExamples(examples) {
  console.log(pc.bold('\nAvailable examples:\n'));
  for (const example of examples) {
    const name = pc.cyan(example.name);
    const desc = example.description ? pc.dim(` - ${example.description}`) : '';
    console.log(`  ${name}${desc}`);
  }
  console.log();
}

async function promptProjectName() {
  const response = await prompts(
    {
      type: 'text',
      name: 'projectName',
      message: 'Project name:',
      initial: 'my-agent',
      validate: (value) =>
        value.trim() ? true : 'Project name is required',
    },
    { onCancel: () => process.exit(0) }
  );
  return response.projectName;
}

async function promptExample(examples) {
  const response = await prompts(
    {
      type: 'select',
      name: 'example',
      message: 'Select an example:',
      choices: examples.map((ex) => ({
        title: ex.displayName || ex.name,
        description: ex.description,
        value: ex.name,
      })),
    },
    { onCancel: () => process.exit(0) }
  );
  return response.example;
}

async function promptOverwrite(dir) {
  const response = await prompts(
    {
      type: 'confirm',
      name: 'overwrite',
      message: `Directory ${pc.cyan(dir)} already exists. Overwrite?`,
      initial: false,
    },
    { onCancel: () => process.exit(0) }
  );
  return response.overwrite;
}

function updatePackageJson(projectPath, projectName) {
  const pkgPath = path.join(projectPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      pkg.name = projectName;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function updatePyprojectToml(projectPath, projectName) {
  const tomlPath = path.join(projectPath, 'pyproject.toml');
  if (fs.existsSync(tomlPath)) {
    try {
      let content = fs.readFileSync(tomlPath, 'utf-8');
      content = content.replace(/^name\s*=\s*"[^"]+"/m, `name = "${projectName}"`);
      fs.writeFileSync(tomlPath, content);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

function detectProjectType(projectPath) {
  if (fs.existsSync(path.join(projectPath, 'package.json'))) {
    return 'node';
  }
  if (
    fs.existsSync(path.join(projectPath, 'pyproject.toml')) ||
    fs.existsSync(path.join(projectPath, 'requirements.txt'))
  ) {
    return 'python';
  }
  return 'unknown';
}

function getDefaultSetup(projectType) {
  if (projectType === 'node') {
    return ['npm install', 'npm run dev'];
  }
  if (projectType === 'python') {
    return ['pip install .', 'python main.py'];
  }
  return [];
}

function printNextSteps(projectName, projectType, exampleData) {
  console.log(`\n  ${pc.green('Done!')} Created ${pc.cyan(projectName)}\n`);
  console.log(`  ${pc.dim('cd')} ${projectName}`);

  // Use custom setup if provided, otherwise fall back to defaults
  const setup = exampleData?.setup || getDefaultSetup(projectType);

  for (const cmd of setup) {
    console.log(`  ${pc.dim(cmd)}`);
  }

  console.log();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(packageJson.version);
    process.exit(0);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  console.log(`\n  ${pc.bold('create-subconscious-app')} ${pc.dim(`v${packageJson.version}`)}\n`);

  // Fetch manifest
  const manifest = await fetchManifest();
  const examples = manifest.examples;

  if (args.list) {
    printExamples(examples);
    process.exit(0);
  }

  // Validate and get example (prompt first in interactive mode)
  let exampleName = args.example;
  let exampleData = null;
  if (exampleName) {
    exampleData = examples.find((ex) => ex.name === exampleName);
    if (!exampleData) {
      console.error(
        pc.red(
          `Unknown example: ${exampleName}. Run with --list to see available examples.`
        )
      );
      process.exit(1);
    }
  } else {
    exampleName = await promptExample(examples);
    exampleData = examples.find((ex) => ex.name === exampleName);
  }

  // Get project name
  let projectName = args.projectName;
  if (!projectName) {
    projectName = await promptProjectName();
  }

  const targetDir = path.resolve(process.cwd(), projectName);

  // Check if directory exists
  if (fs.existsSync(targetDir)) {
    const overwrite = await promptOverwrite(projectName);
    if (!overwrite) {
      console.log(pc.yellow('Aborted.'));
      process.exit(0);
    }
    fs.rmSync(targetDir, { recursive: true, force: true });
  }

  // Download template
  console.log(`\n  ${pc.cyan('◐')} Downloading ${pc.bold(exampleName)}...`);

  try {
    await downloadTemplate(`${REPO_BASE}/${exampleName}`, {
      dir: targetDir,
      force: true,
    });
  } catch (error) {
    console.error(pc.red(`\n  Failed to download template: ${error.message}`));
    process.exit(1);
  }

  // Update project name in config files
  updatePackageJson(targetDir, projectName);
  updatePyprojectToml(targetDir, projectName);

  // Detect project type and print next steps
  const projectType = detectProjectType(targetDir);
  printNextSteps(projectName, projectType, exampleData);
}

main().catch((error) => {
  console.error(pc.red(error.message));
  process.exit(1);
});
