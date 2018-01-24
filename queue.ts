import { log } from "util";

export interface Provider<T, U> {
  namespace(item?: T): string;
  fetchItems(page: number): Promise<T[]>;
  startItem(t: T): Promise<U>;
  completeItem?(res: U, item: T): void;
  failItem?: (err: any, t: T) => void;
}

function sleep(num: number) {
  return new Promise(resolve => setTimeout(resolve, num));
}

export class Queue<T, U=T> {

  static run<T, U>(size: number, provider: Provider<T, U>) {
    return new Queue(size, provider).run();
  }

  private _queue: T[];
  private _workingSize = 0;
  private _working: { [key: string]: Promise<[number, U, T]> } = {};
  private _done = false;
  private _id = 0;

  constructor(public size: number, public provider: Provider<T, U>) { }

  async run() {
    try {
      await this._run();
    } catch (e) {
      if (e.messge !== 'Empty') {
        throw e;
      }
    }
  }

  async gatherItems() {
    log(this.provider.namespace() + ' gathering items');
    let done = false;
    let items: T[] = [];
    let page = 1;
    while (!done) {
      try {
        let fetched = await this.provider.fetchItems(page);
        if (fetched.length) {
          items = items.concat(fetched);
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

  async _run() {
    this._queue = await this.gatherItems();

    while (true) {
      if (this._workingSize < this.size) {
        this.scheduleNext();
      }

      if (this._workingSize < this.size) {
        continue; // Don't wait until queue is full;
      }

      let finished: number;

      try {
        let [id, res, item] = await Promise.race(Object.values(this._working));
        finished = id;

        log(this.provider.namespace(item) + ' complete');

        if (this.provider.completeItem) {
          this.provider.completeItem(res, item);
        }
      } catch ([id, e, item]) {
        finished = id;
        if (this.provider.failItem) {
          this.provider.failItem(e, item);
        }
        log(this.provider.namespace(item) + ` failed ... ${e.message}`);
      }

      if (finished) {
        this._workingSize--;
        delete this._working[finished];
      }
    }
  }

  async scheduleNext() {
    if (this._queue.length === 0) {
      throw new Error(`Empty`);
    }

    let nextId = this._id++;
    let item = this._queue.shift()!;

    log(this.provider.namespace(item) + ' started');

    this._working[nextId] = this.provider.startItem(item)
      .then(x => [nextId, x, item] as [number, U, T])
      .catch(e => { throw [nextId, e, item] });
    this._workingSize++;
  }
}