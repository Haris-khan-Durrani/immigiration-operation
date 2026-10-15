import {readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
for(const folder of ['server','scripts','public','test','integration'])for(const file of await readdir(folder)){if(!file.endsWith('.js'))continue;const result=spawnSync(process.execPath,['--check',folder+'/'+file],{stdio:'inherit'});if(result.status)process.exit(result.status);}
console.log('All JavaScript files pass syntax checks.');
