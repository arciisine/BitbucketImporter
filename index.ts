import * as minimist from 'minimist';
import { BitbucketImporter } from './importer';
import { log } from './util';


async function run() {
  let args = minimist(process.argv, {});
  try {
    await new BitbucketImporter(args.sHost, args.sCreds, args.cOwner, args.cCreds).run()
    log('Done');
  } catch (e) {
    log('Failed', e);
  }
}

run()