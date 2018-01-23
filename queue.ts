export interface Provider<T, U> {
  nextItems(): Promise<T[]>;
  startItem(t: T): Promise<U>;
  completeItem(res: U, item: T): void;
  failItem?: (err: any, t: T) => void;
}

function sleep(num: number) {
  return new Promise(resolve => setTimeout(resolve, num));
}

export class Queue<T, U=T> {
  private _queue: T[];
  private _workingSize = 0;
  private _working: { [key: string]: Promise<[number, U, T]> } = {};
  private _done = false;
  private _id = 0;
  private _seen: Set<T> = new Set();

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

  async _run() {
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
        this.provider.completeItem(res, item);
      } catch ([id, e, item]) {
        if (this.provider.failItem) {
          finished = id;
          this._seen.delete(item);
          this.provider.failItem(e, item);
        } else {
          throw e;
        }
      }

      if (finished) {
        this._workingSize--;
        delete this._working[finished];
      }
    }
  }

  async getNextItem() {
    if (this._queue.length === 0) {
      let toAdd = await this.provider.nextItems();
      for (let item of toAdd) {
        if (!this._seen.has(item)) {
          this._queue.push(item);
          this._seen.add(item)
        }
      }
      if (this._queue.length === 0) {
        throw new Error(`Empty`);
      }
    }
    return this._queue.shift()!;
  }

  async scheduleNext() {
    let nextId = this._id++;
    let item = await this.getNextItem();
    this._working[nextId] = this.provider.startItem(item)
      .then(x => [nextId, x, item] as [number, U, T])
      .catch(e => { throw [nextId, e, item] });
    this._workingSize++;
  }
}