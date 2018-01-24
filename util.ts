import * as childProcess from 'child_process';
import * as rimraf from 'rimraf';
import * as util from 'util';

export let rmdir = util.promisify(rimraf);

export let sleep = (x: number) => new Promise(resolve => setTimeout(resolve, x));

export function log(msg: string, ...args: any[]) {
  console.log(`${new Date().toISOString()} - ${msg}`, ...args);
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
