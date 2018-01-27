import * as childProcess from 'child_process';
import * as rimraf from 'rimraf';
import * as util from 'util';
import * as requestPromise from 'request-promise';


const DEFAULT_HEADERS: { [key: string]: string } = {
  'Accepts': 'application/json'
}

export let rmdir = util.promisify(rimraf);

export let sleep = (x: number) => new Promise(resolve => setTimeout(resolve, x));

export function log(msg: string, ...args: any[]) {
  console.error(`${new Date().toISOString()} - ${msg}`, ...args);
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

export function request<U>(url: string, cred: string, opts?: requestPromise.RequestPromiseOptions) {
  let [user, password] = cred.split(':');
  //log(`[Request] [${(opts && opts.method) || 'GET'}] ${url}`);
  opts = opts || { json: true };
  if (opts.qs) {
    let qs = opts.qs;
    delete opts.qs;
    url = `${url}?` + Object.keys(qs).map(x => `${encode(x)}=${encode(qs[x])}`).join('&')
  }

  let config = {
    auth: { user, password },
    headers: { ...DEFAULT_HEADERS, ...opts.headers || {} },
    json: true,
    ...opts
  };

  if (opts.body) {
    config.headers['Content-Type'] = 'application/json'
  }

  console.log(url, config)

  return requestPromise(url, config) as any as Promise<{ values: U[] }>;
}