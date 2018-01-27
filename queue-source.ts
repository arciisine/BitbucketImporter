import { log, sleep } from './util';

export type QueueSourceFetcher<T> = (page: number) => Promise<T[]>;

export class QueueSource<T> {

  private cache: T[]

  constructor(private fetch: QueueSourceFetcher<T>, private namespace: string) { }

  log(msg: string) {
    log(this.namespace ? this.namespace + ' ' + msg : msg);
  }

  async gatherItems(delay: number = 0) {
    if (this.cache) {
      return JSON.parse(JSON.stringify(this.cache)); //Clone
    }

    let done = false;
    let items: T[] = [];
    let page = 1;

    this.log('Gathering items');

    while (!done) {
      try {
        let fetched = await this.fetch(page);
        if (fetched.length) {
          items = items.concat(fetched);
          await sleep(delay);
        } else {
          done = true;
        }

        page++;
      } catch (e) {
        if (items.length > 0) {
          done = true;
        } else {
          throw e;
        }
      }
    }
    this.log(`Gathered ${items.length} items`);
    this.cache = items;
    return items;
  }
}