import { log, sleep } from './util';

export type QueueSourceFetcher<T> = (chunk: number, size: number) => Promise<T[]>;

export class QueueSource<T> {

  private cache: T[]

  constructor(private fetch: QueueSourceFetcher<T>, private namespace: string, private fetchSize: number) { }

  log(msg: string) {
    log('[Gathering]' + (this.namespace ? ` ${this.namespace} ` : ' ') + msg);
  }

  async gatherItems(delay: number = 0) {
    if (this.cache) {
      return JSON.parse(JSON.stringify(this.cache)); //Clone
    }

    let done = false;
    let items: T[] = [];
    let chunk = 1;

    this.log('Fetching items');

    while (!done) {
      try {
        let fetched = await this.fetch(chunk, this.fetchSize);
        if (fetched.length) {
          items = items.concat(fetched);
          await sleep(delay);
        } else {
          done = true;
        }

        chunk++;
      } catch (e) {
        if (items.length > 0) {
          done = true;
        } else {
          throw e;
        }
      }
    }
    this.log(`Fetched ${items.length} items`);
    this.cache = items;
    return items;
  }
}