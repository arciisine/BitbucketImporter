import { log, sleep } from './util';

export interface Provider<T, U> {
  namespace(item?: T): string;
  fetchItems(page: number): Promise<T[]>;
  startItem(t: T): Promise<U>;
  completeItem?(res: U, item: T): void;
  failItem?: (err: any, t: T) => void;
}

const PROCESS_DELAY = 1000;

export class Queue<T, U=T> {

  static run<T, U>(size: number, provider: Provider<T, U>) {
    return new Queue(size, provider).run();
  }

  private _queue: T[];
  private _working: { [key: string]: Promise<[string, U, T]> } = {};
  private _id = 0;

  constructor(public size: number, public provider: Provider<T, U>) { }

  log(msg: string, item?: T) {
    log(this.provider.namespace(item) + ' ' + msg);
  }

  async gatherItems() {
    this.log('gathering items');

    let done = false;
    let items: T[] = [];
    let page = 1;
    while (!done) {
      try {
        let fetched = await this.provider.fetchItems(page);
        if (fetched.length) {
          items = items.concat(fetched);
          await sleep(PROCESS_DELAY);
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
    this.log(`gathered ${items.length} items`)
    return items;
  }

  async run() {
    this._queue = await this.gatherItems();

    let done = !this.scheduleItem()

    while (!done) {
      let active = Object.keys(this._working).length;

      while (active < this.size && this._queue.length) {
        this.scheduleItem();
        active++
      }

      if (active === 0) {
        break;
      }

      try {
        let [id, res, item] = await Promise.race(Object.values(this._working));

        this.log('completed', item);

        if (this.provider.completeItem) {
          this.provider.completeItem(res, item);
        }
      } catch (err) {
        if (!Array.isArray(err)) {
          throw err;
        }

        let [id, e, item] = err;

        if (this.provider.failItem) {
          this.provider.failItem(e, item);
        }

        this.log(`failed ... ${e.message}`, item);
      }

      await sleep(PROCESS_DELAY);
    }

    this.log('done')
  }

  scheduleItem() {
    if (this._queue.length === 0) {
      return false
    }

    let nextId = '' + (this._id++);
    let item = this._queue.shift()!;

    this.log('started', item);

    this._working[nextId] = this.provider.startItem(item)
      .then(x => {
        delete this._working[nextId];
        return x;
      }, err => {
        delete this._working[nextId];
        throw err;
      })
      .then(x => [nextId, x, item] as [string, U, T])
      .catch(e => { throw [nextId, e || { message: 'Unknown error' }, item] });

    return true;
  }
}