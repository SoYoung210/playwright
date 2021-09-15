/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import path from 'path';
import fs from 'fs';

import { prompt } from 'enquirer';
import colors from 'ansi-colors';

import { executeCommands, createFiles, determinePackageManager, executeTemplate, determineRootDir, Command, languagetoFileExtension } from './utils';

export type PromptOptions = {
  testDir: string,
  installGitHubActions: boolean,
  language: 'JavaScript' | 'TypeScript'
};

const PACKAGE_JSON_TEST_SCRIPT_CMD = 'test:e2e';

class Generator {
  packageManager: 'npm' | 'yarn';
  constructor(private readonly rootDir: string) {
    if (!fs.existsSync(rootDir))
      fs.mkdirSync(rootDir);
    this.packageManager = determinePackageManager(this.rootDir);
  }

  async run() {
    this._printIntro();
    const answers = await this._askQuestions();
    const { files, commands } = await this._identifyChanges(answers);
    executeCommands(this.rootDir, commands);
    await createFiles(this.rootDir, files);
    await this._patchPackageJSON();
    this._printOutro(answers);
  }

  private _printIntro() {
    console.log(colors.yellow(`Getting started with writing ${colors.bold('end-to-end')} tests with ${colors.bold('Playwright')}:`));
    console.log(`Initializing project in '${path.relative(process.cwd(), this.rootDir) || '.'}'`);
  }

  private async _askQuestions() {
    if (process.env.TEST_OPTIONS)
      return JSON.parse(process.env.TEST_OPTIONS);
    return await prompt<PromptOptions>([
      {
        type: 'select',
        name: 'language',
        message: 'Do you want to use TypeScript or JavaScript?',
        choices: [
          { name: 'TypeScript' },
          { name: 'JavaScript' },
        ],
      },
      {
        type: 'text',
        name: 'testDir',
        message: 'Where to put your end-to-end tests?',
        initial: 'e2e'
      },
      {
        type: 'confirm',
        name: 'installGitHubActions',
        message: 'Add a GitHub Actions workflow?',
        initial: true,
      },
    ]);
  }

  private async _identifyChanges(answers: PromptOptions) {
    const commands: Command[] = [];
    const files = new Map<string, string>();
    const fileExtension = languagetoFileExtension(answers.language);

    files.set(`playwright.config.${fileExtension}`, executeTemplate(this._readAsset(`playwright.config.${fileExtension}`), {
      testDir: answers.testDir,
    }));

    if (answers.installGitHubActions) {
      const githubActionsScript = executeTemplate(this._readAsset('github-actions.yml'), {
        installDepsCommand: this.packageManager === 'npm' ? 'npm ci' : 'yarn',
        runTestsCommand: commandToRunTests(this.packageManager),
      });
      files.set('.github/workflows/playwright.yml', githubActionsScript);
    }

    files.set(path.join(answers.testDir, `example.spec.${fileExtension}`), this._readAsset(`example.spec.${fileExtension}`));

    if (!fs.existsSync(path.join(this.rootDir, 'package.json'))) {
      commands.push({
        name: `Initializing ${this.packageManager === 'yarn' ? 'Yarn' : 'NPM'} project`,
        command: this.packageManager === 'yarn' ? 'yarn init -y' : 'npm init -y',
      });
    }

    commands.push({
      name: 'Installing Playwright Test',
      command: this.packageManager === 'yarn' ? 'yarn add --dev @playwright/test' : 'npm install --save-dev @playwright/test',
    });

    commands.push({
      name: 'Downloading browsers',
      command: 'npx playwright install --with-deps',
    });

    files.set('.gitignore', this._buildGitIgnore());

    return { files, commands };
  }

  private _buildGitIgnore(): string {
    let gitIgnore = '';
    if (fs.existsSync(path.join(this.rootDir, '.gitignore')))
      gitIgnore = fs.readFileSync(path.join(this.rootDir, '.gitignore'), 'utf-8').trimEnd() + '\n';
    if (!gitIgnore.includes('node_modules'))
      gitIgnore += 'node_modules/\n';
    gitIgnore += 'test-results/\n';
    return gitIgnore;
  }

  private _readAsset(asset: string): string {
    const assetsDir = path.join(__dirname, '..', 'assets');
    return fs.readFileSync(path.join(assetsDir, asset), 'utf-8');
  }

  private async _patchPackageJSON() {
    const packageJSON = JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf-8'));
    if (!packageJSON.scripts)
      packageJSON.scripts = {};
    if (packageJSON.scripts['test']?.includes('no test specified'))
      delete packageJSON.scripts['test'];
    packageJSON.scripts[PACKAGE_JSON_TEST_SCRIPT_CMD] = `playwright test`;

    const files = new Map<string, string>();
    files.set('package.json', JSON.stringify(packageJSON, null, 2) + '\n'); // NPM keeps a trailing new-line
    await createFiles(this.rootDir, files, true);
  }

  private _printOutro(answers: PromptOptions) {
    console.log(colors.green('✔ Success!') + ' ' + colors.bold(`Created a Playwright Test project at ${this.rootDir}`));
    const pathToNavigate = path.relative(process.cwd(), this.rootDir);
    const prefix = pathToNavigate !== '' ? `  cd ${pathToNavigate}\n` : '';
    console.log(`Inside that directory, you can run several commands:

  ${colors.cyan(commandToRunTests(this.packageManager))}
    Runs the end-to-end tests.

  ${colors.cyan(commandToRunTests(this.packageManager) + ' -- --project=Desktop Chrome')}
    Runs the tests only on Desktop Chrome.

  ${colors.cyan(commandToRunTests(this.packageManager) + ` -- ${answers.testDir}${path.sep}example.spec.${languagetoFileExtension(answers.language)}`)}
    Runs the tests of a specific file.
  
  ${colors.cyan((this.packageManager === 'npm' ? 'npx' : 'yarn') + ' playwright debug ' + commandToRunTests(this.packageManager))}
    Runs the tests in debug mode.

We suggest that you begin by typing:

${colors.cyan(prefix + '  ' + commandToRunTests(this.packageManager))}

Visit https://playwright.dev/docs/intro for more information. ✨

Happy hacking! 🎭`);
  }
}

export function commandToRunTests(packageManager: 'npm' | 'yarn') {
  if (packageManager === 'yarn')
    return `yarn ${PACKAGE_JSON_TEST_SCRIPT_CMD}`;
  return `npm run ${PACKAGE_JSON_TEST_SCRIPT_CMD}`;
}

(async () => {
  const rootDir = determineRootDir();
  const generator = new Generator(rootDir);
  await generator.run();
})().catch(error => {
  console.error(error);
  process.exit(1);
});