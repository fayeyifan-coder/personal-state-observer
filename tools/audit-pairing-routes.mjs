import fs from 'node:fs'
import path from 'node:path'

/**
 * Static tripwire for future Netlify HTTP route contributions.
 * It is NOT a security boundary: indirect imports and generated code need
 * human review. The only trusted composition root for new pairing routes
 * is the isolatedPairingGateway module (not raw pairing stores).
 */
const PAIRING_ROUTES = /(?:pairing|publisher|operator|device[-_/]?(?:enroll|approve|revoke|challenge))/i
const RAW_DB = /(?:approveByOperator|revokeByOperator|createPostgresManualPairingStore|createSignedOperatorPairingGate|\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM)?\s*sync_publisher_devices)/i
const GATE = /isolatedPairingGateway/
const EXT = /\.(?:js|mjs|cjs|ts|mts|cts|jsx|tsx)$/

export function auditRouteSource(relativePath,content) {
  const violations=[]
  if(RAW_DB.test(content)){
    violations.push('route-direct-approval-or-database-permission-bypass')
  }
  if(PAIRING_ROUTES.test(relativePath) && !GATE.test(content)){
    violations.push('pairing-route-must-import-unified-gateway')
  }
  return violations
}

function allFiles(folder,root) {
  if(!fs.existsSync(folder))return []
  const found=[]
  for(const e of fs.readdirSync(folder,{withFileTypes:true})){
    if(e.name==='node_modules'||e.name==='.git'||e.name==='dist')continue
    const fp=path.join(folder,e.name)
    if(e.isDirectory()) found.push(...allFiles(fp,root))
    else if(e.isFile()&&EXT.test(e.name))found.push({
      relative:path.relative(root,fp).replaceAll(path.sep,'/'),
      source:fs.readFileSync(fp,'utf8')
    })
  }
  return found
}
export function auditPotentialRouteFiles(root) {
  const routes=[
    'netlify/functions','functions','api','src/pages/api','src/routes/api'
  ].flatMap(dir=>allFiles(path.join(root,dir),root))
  return routes.flatMap(file=>auditRouteSource(file.relative,file.source)
    .map(rule=>({file:file.relative,rule})))
}

if(process.argv[1] && path.resolve(process.argv[1])===
  path.resolve(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/,''))) {
  const root=process.cwd()
  const findings=auditPotentialRouteFiles(root)
  if(findings.length) {
    for(const f of findings)process.stderr.write('BLOCK: '+f.file+' :: '+f.rule+'\n')
    process.exitCode=1
  }else{
    process.stdout.write('PASS: no direct pairing DB approval found in checked HTTP route directories; manual review still required.\n')
  }
}
