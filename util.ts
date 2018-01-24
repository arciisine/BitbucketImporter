import * as childProcess from 'child_process';
import * as rimraf from 'rimraf';
import * as util from 'util';

export let rmdir = util.promisify(rimraf);

export let sleep = (x: number) => new Promise(resolve => setTimeout(resolve, x));

export function log(msg: string, ...args: any[]) {
  console.log(`${new Date().toISOString()} - ${msg}`, ...args);
}

export function exec(command: string, opts: childProcess.ExecOptions = {}) {
  let child = childProcess.exec(command, opts);
  return new Promise((resolve, reject) => {
    child.addListener("error", reject);
    child.addListener('exit', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject();
      }
    });
  });
}
