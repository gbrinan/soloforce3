"""Store image references. No OCR, visual analysis, criteria generation or model calls."""
import argparse, hashlib, json, re
from pathlib import Path

def load(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def write(path,obj):Path(path).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
def register(image,destination,sample_id,org,project,selection_quote,channel=None):
    if not re.fullmatch(r'[A-Za-z0-9_-]+',sample_id):raise ValueError('Invalid sample ID')
    if channel is not None and (not isinstance(channel,str) or not channel.strip()):raise ValueError('Invalid channel')
    image=Path(image);raw=image.read_bytes();sha=hashlib.sha256(raw).hexdigest()
    if raw.startswith(b'\xff\xd8\xff'):suffix='.jpg';mime='image/jpeg'
    elif raw.startswith(b'\x89PNG\r\n\x1a\n'):suffix='.png';mime='image/png'
    elif raw[:4]==b'RIFF' and raw[8:12]==b'WEBP':suffix='.webp';mime='image/webp'
    else:raise ValueError('Unsupported image signature')
    folder=Path(destination)/sample_id
    if folder.exists():
        s=validate(folder)
        if (s['asset']['sha256'],s['org_id'],s['project_id'],s['selection']['evidence'])==(sha,org,project,selection_quote) and (channel is None or s.get('channel')==channel):return folder
        raise ValueError('Existing reference differs; prepare an explicit revision')
    folder.mkdir(parents=True);asset=folder/('original'+suffix);asset.write_bytes(raw)
    write(folder/'sample.json',{'schema_version':2,'sample_id':sample_id,'revision':1,'org_id':org,'project_id':project,'channel':channel if channel is not None else 'unknown','role':'golden_reference','load_policy':'on_demand','selection':{'status':'user_selected','evidence':selection_quote},'asset':{'file':asset.name,'sha256':sha,'bytes':len(raw),'mime_type':mime,'original_name':image.name},'analysis_policy':'storage_only','title':image.name})
    return folder

def validate(folder):
    folder=Path(folder);s=load(folder/'sample.json');a=s['asset'];target=(folder/a['file']).resolve()
    if target.parent!=folder.resolve():raise ValueError('Asset outside sample directory')
    if hashlib.sha256(target.read_bytes()).hexdigest()!=a['sha256']:raise ValueError('Changed asset')
    if s.get('analysis_policy')!='storage_only' or s.get('load_policy')!='on_demand':raise ValueError('Reference must be storage-only and on-demand')
    if any(k in s for k in ['observation','criteria','performance','reference_review']):raise ValueError('Analysis belongs to a separately requested task, not the stored reference')
    return s

def render(folder):
    folder=Path(folder);s=validate(folder)
    (folder/'index.md').write_text(f"# {s['sample_id']} · {s.get('title','이미지 레퍼런스')}\n\n{s['org_id']}/{s['project_id']} · revision {s['revision']}\n\n{s['selection']['evidence']}\n\n원본을 보관하고 필요할 때 참조한다. 자동 이미지 분석·OCR·평가 기준 생성은 수행하지 않는다.\n\n[원본 이미지 열기]({s['asset']['file']}) · [등록 정보](sample.json)\n", encoding='utf-8')

def packet(folder,org,project):
    s=validate(folder)
    if (s['org_id'],s['project_id'])!=(org,project):raise ValueError('Reference outside requested scope')
    return {'sample_id':s['sample_id'],'revision':s['revision'],'org_id':org,'project_id':project,'asset_sha256':s['asset']['sha256'],'original_asset_path':str((Path(folder)/s['asset']['file']).resolve()),'title':s['title'],'selection':s['selection'],'load_policy':'on_demand','analysis_policy':'storage_only'}

def main():
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='cmd',required=True)
    x=sub.add_parser('register');x.add_argument('image');x.add_argument('destination');x.add_argument('--id',required=True);x.add_argument('--org',required=True);x.add_argument('--project',required=True);x.add_argument('--selection-quote',required=True)
    x.add_argument('--channel', help='Explicit usage channel; omitted means unknown for new samples')
    x=sub.add_parser('packet');x.add_argument('folder');x.add_argument('output');x.add_argument('--org',required=True);x.add_argument('--project',required=True)
    for c in ['validate','render']:x=sub.add_parser(c);x.add_argument('folder')
    a=p.parse_args()
    if a.cmd=='register':print(register(a.image,a.destination,a.id,a.org,a.project,a.selection_quote,a.channel))
    elif a.cmd=='render':render(a.folder)
    elif a.cmd=='packet':write(a.output,packet(a.folder,a.org,a.project))
    else:validate(a.folder);print('Stored reference hash and policy valid')
if __name__=='__main__':main()
