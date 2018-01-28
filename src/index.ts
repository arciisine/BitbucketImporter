import * as minimist from 'minimist';
import { BitbucketImporter } from './importer';
import { log } from './util';

const VALID_OPS = ['archive', 'import', 'userscript'];

const OPTIONS: { [key: string]: string } = {
  sHost: 'Server Host',
  sCreds: 'Server user:pass',
  cOwner: 'Cloud Team',
  cCreds: 'Cloud user:pass'
}

async function run() {
  process.on('unhandledRejection', error => {
    log('unhandledRejection', error);
    process.exit(1);
  });

  let args = minimist(process.argv, {});
  try {
    let op = process.argv.pop();
    let valid = VALID_OPS.indexOf(op!) >= 0 &&
      Object.keys(OPTIONS).reduce((acc, k) => { acc = acc && !!args[k]; return acc }, true);

    if (!valid) {
      const flags = Object.keys(OPTIONS).map(x => `-${x} <${OPTIONS[x]}>`).join(' ');
      const ops = VALID_OPS.join('|')
      console.log(`[USAGE] ./importer.sh ${flags} [${ops}]`)
      process.exit(1);
    }

    let importer = new BitbucketImporter(args.sHost, args.sCreds, args.cOwner, args.cCreds);

    log(`Starting ${op}`);
    switch (op) {
      case 'archive':
        await importer.archiveServerProjects();
        break;
      case 'import':
        await importer.deleteCloudRepositories();
        await importer.deleteCloudProjects();
        await importer.importServerProjects();
        break;
      case 'userscript':
        let res = await importer.generateUserMigrationScript();
        console.log(res);
        break;
    }
    log('Done');
  } catch (e) {
    log('Failed', e);
  }
}

run()