import * as minimist from 'minimist';
import { BitbucketImporter } from './importer';
import { log } from './util';



async function run() {
  process.on('unhandledRejection', error => {
    log('unhandledRejection', error);
    process.exit(1);
  });


  let args = minimist(process.argv, {});
  try {
    let op = args[args.length - 1];
    if (!args.sHost || !args.sCreds || !args.cOwner || !args.cCreds || ['archive', 'import', 'userscript'].indexOf(op) < 0) {
      console.log('[USAGE] ./importer.sh -sHost <Server Host> -sCreds <Server user:pass> -cOwner <Cloud Team> -cCred <Cloud user:pass> [archive|import|userscript]')
      process.exit(1);
    }

    let importer = new BitbucketImporter(args.sHost, args.sCreds, args.cOwner, args.cCreds);

    log('Starting');
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