import * as minimist from 'minimist';
import { BitbucketImporter } from './importer';
import { log } from './util';


async function run() {
  let args = minimist(process.argv, {});
  try {
    let importer = new BitbucketImporter(args.sHost, args.sCreds, args.cOwner, args.cCreds);
    log('Starting');
    await importer.deleteRepositories();
    await importer.deleteProjects();
    await importer.importProjects();
    log('Done');
  } catch (e) {
    log('Failed', e);
  }
}

run()