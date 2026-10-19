import fs from 'node:fs';import path from 'node:path';import {ROOT} from '../src/store.js';import {runSupervisor} from '../src/supervisor.js';
const log=path.join(ROOT,'logs','supervisor.log');fs.mkdirSync(path.dirname(log),{recursive:true});
process.exitCode=await runSupervisor({report:message=>{fs.appendFileSync(log,new Date().toISOString()+' '+message+'\n');console.error(message);}});
