#!/usr/bin/env node
/**
 * Read-only inspection of a public operator manifest. Never opens the
 * encrypted private PEM, creates keys, signs, or contacts any network.
 * A supplied trusted fingerprint must have been checked OUT OF BAND.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertOperatorManifest, PINNED_MANIFEST_VERSION } from './operator-offline-core.mjs'

const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const FP=/^[0-9a-f]{64}$/
function outsideRepository(input){
  if(typeof input!=='string'||!path.isAbsolute(input))
    throw Error('必须使用仓库外的绝对文件路径')
  const full=path.resolve(input)
  const rel=path.relative(REPO,full)
  if(rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel)))
    throw Error('拒绝在 Git 工作树中读取操作员信任清单')
  let cursor=full
  while(true){
    try {
      if(fs.lstatSync(cursor).isSymbolicLink())
        throw Error('信任清单路径不得经过符号链接或目录联接点')
    } catch(error){
      if(error?.code!=='ENOENT')throw error
    }
    if(fs.existsSync(path.join(cursor,'.git')))
      throw Error('拒绝在 Git 工作树中读取操作员信任清单')
    if(path.dirname(cursor)===cursor)break
    cursor=path.dirname(cursor)
  }
  return full
}
function readLimitedJson(p){
  const stat=fs.statSync(p)
  if(!stat.isFile()||stat.size>16384||stat.size<10)
    throw Error('公钥清单文件尺寸或类型错误')
  return JSON.parse(fs.readFileSync(p,'utf8'))
}
function run(){
  const args=process.argv.slice(2)
  if(args.length===1&&args[0]==='--help'){
    process.stdout.write(
      'node tools/operator-offline-preflight.mjs --manifest "仓库外/operator-public.json" '+
      '--trusted-issuer-fingerprint "来自独立渠道核对的64位小写SHA256"\n'+
      '完全只读。不能以文件自身、同一网页的重复显示证明公钥可信。\n'
    )
    return
  }
  if(args.length!==4||args[0]!=='--manifest'||
    args[2]!=='--trusted-issuer-fingerprint'||!FP.test(args[3])) {
    throw Error('缺少独立渠道核对的完整服务器公钥指纹；使用 --help 查看用法')
  }
  const manifest=assertOperatorManifest(readLimitedJson(outsideRepository(args[1])))
  if(manifest.schema!==PINNED_MANIFEST_VERSION)
    throw Error('旧版公钥清单未绑定服务器可信公钥，拒绝通过')
  if(manifest.receiptIssuer.fingerprint!==args[3])
    throw Error('与独立核对的服务器签发公钥指纹不一致')
  process.stdout.write(
    'PASS：公开操作员清单的签名绑定及服务器公钥指纹校验一致。\n'+
    '服务器站点：'+manifest.siteId+'\n'+
    '操作员公钥指纹：'+manifest.fingerprint+'\n'+
    '证据签发公钥指纹：'+manifest.receiptIssuer.fingerprint+'\n'+
    '仅验证文件内部绑定和输入的一致性；不能替代首次独立渠道信任、'+
    'Windows NTFS ACL 检查，或服务器端实际设备配对。\n'
  )
}
try{run()}catch(error){
  process.stderr.write('FAIL：公开信任预检拒绝通过。'+
    (error instanceof Error?error.message:'')+'\n')
  process.exitCode=1
}
