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

  static async run<T, U>(size: number, provider: Provider<T, U>) {
    try {
      await new Queue(size, provider).run();
    } catch (e) {
      if (e.message !== 'Empty') {
        throw e;
      }
    }
  }

  private _queue: T[];
  private _workingSize = 0;
  private _working: { [key: string]: Promise<[number, U, T]> } = {};
  private _done = false;
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
    return items;
  }

  async run() {
    this._queue = await this.gatherItems();

    this.scheduleItem();

    while (this._workingSize) {
      let finished: number;

      while (this._workingSize < this.size && this._queue.length) {
        this.scheduleItem();
      }

      try {
        let [id, res, item] = await Promise.race(Object.values(this._working));
        finished = id;

        this.log('completed', item);

        if (this.provider.completeItem) {
          this.provider.completeItem(res, item);
        }
      } catch (err) {
        if (!Array.isArray(err)) {
          throw err;
        }

        let [id, e, item] = err;
        finished = id;
        if (this.provider.failItem) {
          this.provider.failItem(e, item);
        }

        this.log(`failed ... ${e.message}`, item);
      }

      await sleep(PROCESS_DELAY);

      this.finishItem(finished);
    }
  }

  scheduleItem() {
    if (this._queue.length === 0) {
      throw new Error(`Empty`);
    }

    let nextId = this._id++;
    let item = this._queue.shift()!;
    this._workingSize++;

    this.log('started', item);

    this._working[nextId] = this.provider.startItem(item)
      .then(x => [nextId, x, item] as [number, U, T])
      .catch(e => { throw [nextId, e || { message: 'Unknown error' }, item] });
  }

  finishItem(id: number) {
    this._workingSize--;
    delete this._working[id];
  }
}