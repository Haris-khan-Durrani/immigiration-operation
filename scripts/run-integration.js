import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','test/workflow.integration.test.js'],{stdio:'inherit',env:{...process.env,RUN_MYSQL_TESTS:'true',RUN_BROWSER_TESTS:process.argv.includes('--browser')?'true':'false',EMAIL_DELIVERY_ENABLED:'false',NODE_ENV:'test'}});
process.exitCode=result.status || 0;
