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
    let importer = new BitbucketImporter(args.sHost, args.sCreds, args.cOwner, args.cCreds);
    log('Starting');
    //await importer.archiveServerProjects();
    //await importer.deleteCloudRepositories();
    //await importer.deleteCloudProjects();
    //await importer.importServerProjects();
    await importer.generateRepoMapping();
    log('Done');
  } catch (e) {
    log('Failed', e);
  }
}

run()