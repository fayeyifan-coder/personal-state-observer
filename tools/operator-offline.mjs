#!/usr/bin/env node
/**
 * Completely OFFLINE, interactive Windows operator-key prototype.
 * This tool has no network imports. It never asks for a Netlify password.
 * Running it cannot register, approve, revoke or sync a real device.
 */
import { stdin, stdout, stderr, exit } from 'node:process'
import * as fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'
import { createInterface as createPromiseInterface } from 'node:readline/promises'
import {
  createOfflineOperatorKey, assertOperatorManifest,
  createProposedCommand, signOfflineOperatorCommand,
  verifyOfflineOperatorCommand
} from './operator-offline-core.mjs'

const REPO=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const PRIVATE_NAME='operator-encrypted-private.pem'
const PUBLIC_NAME='operator-public.json'
const HELP=`离线操作员密钥工具（仅原型；无服务器审批功能）
  node tools/operator-offline.mjs init --dir "仓库外全新目录" --site-id UUID
  node tools/operator-offline.mjs sign --dir "已有密钥目录" --request "候选.json" --out "已签名.json"
  node tools/operator-offline.mjs verify --dir "已有密钥目录" --signed "已签名.json"
注意：口令只在本地交互输入，不接受命令行参数、环境变量或自动提交。
候选文件应来自独立可信核对；签名只能生成离线凭证，不会连接服务器。
`
function fail(message){throw Error(message)}
function optionMap(parts) {
  const args={}
  for(let i=0;i<parts.length;i+=2) {
    const key=parts[i]
    if(!key?.startsWith('--')||i+1>=parts.length||
      parts[i+1].startsWith('--')||Object.hasOwn(args,key))fail('命令参数不正确；使用 --help 查看说明')
    if(!['--dir','--site-id','--request','--out','--signed'].includes(key))
      fail('不接受这个参数，包括命令行口令：'+key)
    args[key]=parts[i+1]
  }
  return args
}
function requireOptions(args,exact) {
  if(Object.keys(args).length!==exact.length||exact.some(k=>!args[k])) {
    fail('请提供且仅提供 '+exact.join('、'))
  }
}
function notInsideGit(input){
  if(typeof input!=='string'||!input.trim())fail('必须指定仓库之外的绝对路径')
  const resolved=path.resolve(input)
  if(!path.isAbsolute(input))fail('必须使用绝对路径')
  let ancestor=resolved
  while(true){
    // Reject symlinks and Windows junctions along the whole path. Without
    // this, a directory outside Git could point into Git through a link.
    try {
      if(fs.lstatSync(ancestor).isSymbolicLink())
        fail('安全路径不能通过符号链接或目录联接点')
    } catch(error) {
      if(error?.code!=='ENOENT')throw error
    }
    if(fs.existsSync(path.join(ancestor,'.git'))) {
      fail('拒绝在 Git 工作树内存储操作员密钥或签名文件')
    }
    if(ancestor===path.dirname(ancestor))break
    ancestor=path.dirname(ancestor)
  }
  const rel=path.relative(REPO,resolved)
  if(rel===''||(!rel.startsWith('..')&&!path.isAbsolute(rel)))fail('拒绝在此代码仓库内操作')
  return resolved
}
function readJson(fp){
  if(fs.statSync(fp).size>16_384)fail('输入 JSON 太大，拒绝解析')
  return JSON.parse(fs.readFileSync(fp,'utf8'))
}
function loadDir(value) {
  const dir=notInsideGit(value)
  const stat=fs.statSync(dir)
  if(!stat.isDirectory())fail('操作员密钥目录不是文件夹')
  const manifest=assertOperatorManifest(readJson(path.join(dir,PUBLIC_NAME)))
  const encryptedPem=fs.readFileSync(path.join(dir,PRIVATE_NAME),'utf8')
  return {dir,manifest,encryptedPem}
}
async function promptText(label){
  if(!stdin.isTTY||!stdout.isTTY)fail('敏感操作必须在交互式终端进行')
  const iface=createPromiseInterface({input:stdin,output:stdout})
  try {return await iface.question(label)} finally {iface.close()}
}
readline.emitKeypressEvents(stdin)
function promptSecret(label) {
  if(!stdin.isTTY||!stdout.isTTY||typeof stdin.setRawMode!=='function') {
    fail('安全口令输入需要本机交互式终端，不允许管道或环境变量传入')
  }
  stdout.write(label)
  return new Promise((resolve,reject)=>{
    let answer=''
    const rawWas=stdin.isRaw
    function finish(error) {
      stdin.removeListener('keypress',onKey)
      stdin.setRawMode(Boolean(rawWas))
      stdin.pause()
      stdout.write('\n')
      if(error)reject(error)
      else resolve(answer)
    }
    function onKey(char,key={}) {
      if(key.ctrl && key.name==='c'){finish(Error('已取消操作'));return}
      if(key.name==='enter'||key.name==='return'){finish();return}
      if(key.name==='backspace'){answer=answer.slice(0,-1);return}
      if(key.ctrl||key.meta||char==='\u001b'||!char)return
      if([...answer].length+[...char].length<=1024 &&
        !/[\u0000-\u001f\u007f]/.test(char))answer+=char
    }
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('keypress',onKey)
  })
}
function show(c){
  stdout.write([
    '即将签署的离线操作（不可撤销地签出凭证，但此工具不会访问数据库）',
    '操作：'+c.action,'站点：'+c.siteId,'账户：'+c.ownerId,
    '申请：'+c.requestId,'设备：'+c.deviceId,
    '手机完整指纹：'+c.fingerprint,'有效期截止：'+c.expiresAt
  ].join('\n')+'\n')
}
async function main() {
  const [action,...tail]=process.argv.slice(2)
  if(!action||action==='--help'||action==='help'){
    stdout.write(HELP);return
  }
  const args=optionMap(tail)
  if(action==='init'){
    requireOptions(args,['--dir','--site-id'])
    const dir=notInsideGit(args['--dir'])
    if(fs.existsSync(dir))fail('目录已存在；绝不覆盖已有密钥或在旧文件夹内创建')
    const pass1=await promptSecret('新密钥口令（至少16字符，输入不会显示）：')
    const pass2=await promptSecret('再次输入口令确认：')
    if(pass1!==pass2)fail('两次口令不一致，未生成密钥')
    const {encryptedPrivatePem,manifest}=createOfflineOperatorKey(args['--site-id'],pass1)
    fs.mkdirSync(dir,{mode:0o700})
    try {
      fs.writeFileSync(path.join(dir,PRIVATE_NAME),encryptedPrivatePem,{
        flag:'wx',mode:0o600
      })
      fs.writeFileSync(path.join(dir,PUBLIC_NAME),
        JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600})
    } catch(error) {
      // Fail closed: directory is new; never delete an existing user's key.
      stderr.write('创建文件未完成，请在签名之前人工检查新目录。\n')
      throw error
    }
    stdout.write('已在仓库外生成加密操作员私钥和公开公钥清单。\n')
    stdout.write('公钥指纹：'+manifest.fingerprint+'\n')
    stdout.write('此操作不会启用服务器设备审批；请离线保管口令和密钥。\n')
    return
  }
  if(action==='sign'){
    requireOptions(args,['--dir','--request','--out'])
    const {manifest,encryptedPem}=loadDir(args['--dir'])
    const request=readJson(notInsideGit(args['--request']))
    const target=notInsideGit(args['--out'])
    if(fs.existsSync(target))fail('目标文件已存在，绝不覆盖已有签名')
    if(!fs.existsSync(path.dirname(target)))fail('签名输出文件夹不存在')
    stdout.write('请用 iPhone 实际显示的指纹，以及独立核验的账户身份核对这份申请。\n')
    stdout.write('候选操作：'+request.action+'\n')
    stdout.write('候选账户：'+request.ownerId+'\n')
    stdout.write('候选设备：'+request.deviceId+'\n')
    stdout.write('候选指纹：'+request.fingerprint+'\n')
    const expectedOwner=(await promptText('独立确认账户 ID（完整输入）：')).trim()
    const expectedFingerprint=(await promptText('输入手机显示的完整64字符公钥指纹：')).trim()
    const actionWord=request.action==='approve-publisher'?'APPROVE':'REVOKE'
    const confirm=(await promptText('确认操作类型，请输入 '+actionWord+'：')).trim()
    const acceptedAction=confirm===actionWord?request.action:null
    const command=createProposedCommand(request,manifest,{
      ownerId:expectedOwner,fingerprint:expectedFingerprint,action:acceptedAction
    })
    show(command)
    const passphrase=await promptSecret('审批私钥口令（本机解锁，不显示）：')
    // Sign exactly the same previewed command, not a fresh unseen nonce.
    const signed=signOfflineOperatorCommand(command,encryptedPem,passphrase,manifest)
    fs.writeFileSync(target,JSON.stringify(signed,null,2)+'\n',{
      flag:'wx',mode:0o600
    })
    stdout.write('已输出离线签名凭证（未发送、未执行设备审批）：'+target+'\n')
    return
  }
  if(action==='verify'){
    requireOptions(args,['--dir','--signed'])
    const {manifest}=loadDir(args['--dir'])
    const signed=readJson(notInsideGit(args['--signed']))
    if(!verifyOfflineOperatorCommand(signed,manifest))
      fail('离线签名无效、指令已过期或站点不匹配')
    stdout.write('离线签名格式验证通过；服务器尚未执行该指令。\n')
    return
  }
  fail('未知操作；使用 --help 查看命令')
}
main().catch(err=>{stderr.write('操作拒绝：'+(err?.message||'未知错误')+'\n');exit(1)})
