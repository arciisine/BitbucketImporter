import * as minimist from 'minimist';
import { BitbucketImporter } from './importer';
import { log } from './util';

const VALID_OPS = ['archive-projects', 'import', 'gen-user-script', 'verify-import', 'disable-projects'];

const OPTIONS: { [key: string]: { flags: string[], label: string, required?: boolean } } = {
  'serverHost': {
    flags: ['--sh', '--server-host'],
    label: 'Server Host',
    required: true
  },
  'serverUser': {
    flags: ['--su', '--server-user'],
    label: 'Server User',
    required: true
  },
  'serverPass': {
    flags: ['--sp', '--server-pass'],
    label: 'Server Password',
    required: true
  },
  'cloudTeam': {
    flags: ['--ct', '--cloud-team'],
    label: 'Cloud Team',
    required: true
  },
  'cloudUser': {
    flags: ['--cu', '--cloud-user'],
    label: 'Cloud User',
    required: true
  },
  'cloudPass': {
    flags: ['--cp', '--cloud-pass'],
    label: 'Cloud Password',
    required: true
  },
  'dryRun': {
    flags: ['--dry', '--dry-run'],
    label: ''
  }
}

async function run() {
  process.on('unhandledRejection', error => {
    log('unhandledRejection', error);
    process.exit(1);
  });

  let args = minimist(process.argv, {});
  let cfg: { [key: string]: any } = {
    cloudHost: 'bitbucket.org'
  };

  for (let prop of Object.keys(OPTIONS)) {
    for (let flg of OPTIONS[prop].flags) {
      flg = flg.replace(/^-+/, '');
      if (flg in args) {
        cfg[prop] = args[flg]
        break;
      }
    }
  }

  try {
    let op = process.argv.pop();
    let validOp = VALID_OPS.indexOf(op!) >= 0
    let validFlags = Object
      .keys(OPTIONS)
      .filter(x => OPTIONS[x].required)
      .reduce((acc, k) => {
        acc = acc && !!cfg[k];
        return acc
      }, true);

    let valid = validOp && validFlags;

    if (!valid) {
      const flags = Object
        .keys(OPTIONS)
        .map(x => OPTIONS[x])
        .map(x => `${!x.required ? '[' : ''}${x.flags.join('|')}${x.label ? ` <${x.label}>` : ''}${!x.required ? ']' : ''}`)
        .join(' ');

      const ops = VALID_OPS.join('|')
      console.log(`[USAGE] ./importer.sh ${flags} [${ops}]`)
      process.exit(1);
    }

    let importer = new BitbucketImporter(
      cfg.serverHost, cfg.serverUser, cfg.serverPass,
      cfg.cloudTeam, cfg.cloudUser, cfg.cloudPass, cfg.cloudHost,
      cfg.dryRun !== undefined);

    log(`Starting ${op}`);
    await importer.verifyCredentials();

    switch (op) {
      case 'archive-projects':
        await importer.archiveServerProjects();
        break;
      case 'import':
        await importer.deleteCloudRepositories();
        await importer.deleteCloudProjects();
        await importer.importServerProjects();
        break;
      case 'gen-user-script':
        let res = await importer.generateUserMigrationScript();
        console.log(res);
        break;
      case 'verify-import':
        await importer.verifyImported();
        break;
      case 'disable-projects':
        await importer.disableServerProjects();
        break;
    }
    log('Done');
  } catch (e) {
    log('Failed', e);
  }
}

run()