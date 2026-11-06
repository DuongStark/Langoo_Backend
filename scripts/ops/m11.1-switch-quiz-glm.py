from pathlib import Path
import datetime,json,os,re,subprocess
root=Path('/opt/langoo/app'); env=root/'.env'; before=env.read_bytes(); text=before.decode(); values={}
for line in text.splitlines():
 if '=' in line and not line.lstrip().startswith('#'):
  k,v=line.split('=',1);values[k.strip()]=v.strip().strip('"').strip("'")
assert values.get('AI_CHAT_MODEL')=='deepseek-ai/deepseek-v4.1-flash'
assert values.get('AI_CHAT_REASONING_EFFORT')=='none'
changes={'AI_QUIZ_MODEL':'zai-org/glm-5.3-flash','AI_QUIZ_VALIDATOR_MODEL':'zai-org/glm-5.3-flash','AI_QUIZ_REASONING_EFFORT':'low','AI_QUIZ_TIMEOUT_MS':'60000'}
backup=Path('/opt/langoo/backups/m11.1');backup.mkdir(mode=0o700,exist_ok=True)
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
bak=backup/('before-'+stamp+'.env');bak.write_bytes(before);bak.chmod(0o600)
for k,v in changes.items():
 pattern=r'(?m)^'+re.escape(k)+r'=.*$'
 if re.search(pattern,text):text=re.sub(pattern,k+'='+v,text)
 else:text+='\n'+k+'='+v+'\n'
tmp=root/('.env.m111-'+stamp);tmp.write_text(text);tmp.chmod(0o600);st=env.stat();os.chown(tmp,st.st_uid,st.st_gid);os.replace(tmp,env)
try:subprocess.run(['sudo','-u','langoo','-H','pm2','reload','langoo-api','--update-env'],check=True,stdout=subprocess.DEVNULL)
except Exception:
 env.write_bytes(before);env.chmod(0o600);subprocess.run(['sudo','-u','langoo','-H','pm2','reload','langoo-api','--update-env'],stdout=subprocess.DEVNULL);raise
receipt={'code':'M11.1','utc':stamp,'changed':changes,'chat_model':values['AI_CHAT_MODEL'],'chat_effort':values['AI_CHAT_REASONING_EFFORT'],'backup':str(bak),'scope':'ENV only, no application code deployment'}
(backup/'last-switch.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
