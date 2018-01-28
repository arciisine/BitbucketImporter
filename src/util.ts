import * as childProcess from 'child_process';
import * as rimraf from 'rimraf';
import * as util from 'util';
import * as requestPromise from 'request-promise';
import * as fs from 'fs';
import { RequestPromiseOptions } from 'request-promise';

export type Requestor<T> = (path: string, opts?: requestPromise.RequestPromiseOptions) => Promise<T>

const DEFAULT_HEADERS: { [key: string]: string } = {
  'Accepts': 'application/json'
}

export let rmdir = util.promisify(rimraf);

export let sleep = (x: number) => new Promise(resolve => setTimeout(resolve, x));

export function log(msg: string, ...args: any[]) {
  console.error(`${new Date().toISOString()} ${(log as any)['prefix'] || ''}- ${msg}`, ...args);
}

export async function exec(command: string, opts: childProcess.ExecOptions = {}) {
  return new Promise((resolve, reject) => {
    childProcess.exec(command, opts, (err, stdout, stderr) => {
      if (err) {
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

export function encode(val: string) {
  return ('' + val).replace(/ /g, '%20');
}

export function requestor(opts: requestPromise.RequestPromiseOptions & { dryRun?: boolean }) {
  let def = {
    ...opts,
    headers: { ...DEFAULT_HEADERS, ...opts.headers || {} },
    json: true
  }

  return request.bind(null, def);
}

export function request<U>(baseOpts: requestPromise.RequestPromiseOptions & { dryRun?: boolean }, path: string, extra: requestPromise.RequestPromiseOptions = {}) {
  let opts = {
    ...baseOpts,
    ...extra,
    headers: {
      ...(baseOpts.headers || {}),
      ...(extra || {}).headers
    }
  };

  if (opts.qs) {
    let qs = opts.qs;
    delete opts.qs;
    path += '?' + Object.keys(qs).map(x => `${encode(x)}=${encode(qs[x])}`).join('&')
  }

  const method = ('' + (opts.method || 'GET')).toUpperCase()
  const suppress = !!opts.dryRun && method !== 'GET';

  log(`${suppress ? '[SKIPPED] ' : ''}${method} ${baseOpts.baseUrl}${path}`, opts);

  if (suppress) {
    return Promise.resolve({});
  } else {
    return (requestPromise(path, opts) as any as Promise<U>);
  }
}

export function CacheFile(f: string): MethodDecorator {
  return function (target: any, property: any, descriptor: any) {
    let og = descriptor.value;
    descriptor.value = function (...args: any[]): Promise<any> {
      if (!fs.existsSync(f)) {
        return og.apply(this, args).then((res: any) => {
          fs.writeFileSync(f, JSON.stringify(res));
          return res;
        })
      } else {
        let content = JSON.parse(fs.readFileSync(f).toString())
        return Promise.resolve(content);
      }
    }
  }
}