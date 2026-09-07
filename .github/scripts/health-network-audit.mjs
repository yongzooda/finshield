// Health 시험 서버 전용 preload. 외부 HTTP 전송은 차단하고 숫자만 기록한다.
import {syncBuiltinESMExports} from 'node:module';
import http from 'node:http';
import https from 'node:https';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
const directory=process.env.HEALTH_AUDIT_DIRECTORY;
if(!directory)throw new Error('HEALTH_AUDIT_DIRECTORY_REQUIRED');
const counts={fetch:0,http:0,https:0};
const record=()=>writeFileSync(join(directory,`network-${process.pid}.json`),JSON.stringify(counts),{mode:0o600});
const block=kind=>{counts[kind]++;record();throw new Error('HEALTH_EXTERNAL_HTTP_BLOCKED');};
globalThis.fetch=async()=>block('fetch');
http.request=()=>block('http');http.get=()=>block('http');
https.request=()=>block('https');https.get=()=>block('https');
syncBuiltinESMExports();
record();
