"""Read-only presentation inventory. Does not render, OCR, transcribe or run an LLM."""
import argparse,collections,hashlib,json,posixpath,re,zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
MAX_XML=8*1024*1024

def sha_file(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def inventory(path):
    path=Path(path);before=path.stat();sha=sha_file(path)
    result={'source_name':path.name,'source_uri':str(path.resolve()),'sha256':sha,'bytes':before.st_size,'status':'container_inspected','content_read':False,'actions':['streaming_hash','zip_directory_inventory'],'llm_calls':0}
    with zipfile.ZipFile(path) as z:
        infos=z.infolist();names=set(i.filename for i in infos);sizes={i.filename:i.file_size for i in infos}
        groups=collections.defaultdict(lambda:{'count':0,'stored_bytes':0,'expanded_bytes':0})
        for i in infos:
            suffix=Path(i.filename).suffix.lower() or '(none)';g=groups[suffix];g['count']+=1;g['stored_bytes']+=i.compress_size;g['expanded_bytes']+=i.file_size
        result.update(member_count=len(infos),expanded_bytes=sum(i.file_size for i in infos),by_extension=dict(sorted(groups.items())),largest_members=[{'path':i.filename,'bytes':i.file_size} for i in sorted(infos,key=lambda x:x.file_size,reverse=True)[:15]])
        result['media']=[{'path':i.filename,'bytes':i.file_size,'status':'stored_not_read'} for i in infos if i.filename.startswith(('Data/','ppt/media/'))]
        def xml(member):
            if sizes[member]>MAX_XML:raise ValueError('XML part exceeds budget: '+member)
            return ET.fromstring(z.read(member))
        if 'ppt/presentation.xml' in names:
            result['format']='pptx';ns={'p':'http://schemas.openxmlformats.org/presentationml/2006/main'}
            rels={x.attrib['Id']:x.attrib for x in xml('ppt/_rels/presentation.xml.rels')}
            slides=[]
            for ordinal,entry in enumerate(xml('ppt/presentation.xml').findall('p:sldIdLst/p:sldId',ns),1):
                rid=entry.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'];rel=rels[rid]
                if rel.get('TargetMode')=='External':raise ValueError('External slide relationship')
                target=rel['Target'];part=posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'ppt/'+target)
                if not part.startswith('ppt/slides/') or part not in names:raise ValueError('Invalid slide part')
                slides.append({'ordinal':ordinal,'presentation_slide_id':entry.attrib['id'],'part':part,'status':'pending_text_extraction'})
            result.update(slide_count=len(slides),slide_order='presentation.xml relationship order',slides=slides,next_step='Extract slide text, notes and relationship IDs per ordered slide; render only selected slides')
        elif 'Index/Document.iwa' in names:
            result['format']='keynote-iwa';parts=sorted(n for n in names if re.fullmatch(r'Index/Slide(?:-[0-9-]+)?\.iwa',n));templates=[n for n in names if n.startswith('Index/TemplateSlide')]
            result.update(slide_count=None,slide_order='unknown_until_keynote_document_graph_or_export',slide_archive_candidates=len(parts),template_archive_candidates=len(templates),slide_parts=parts,next_step='Export a derivative PPTX/PDF using a compatible renderer, then verify actual slide count/order against Keynote; do not treat IWA filenames as slide order')
        else:result.update(format='unknown_zip',slide_count=None,next_step='Choose a compatible parser')
    after=path.stat()
    if (before.st_size,before.st_mtime_ns)!=(after.st_size,after.st_mtime_ns):raise ValueError('Source changed during inspection')
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('output');a=p.parse_args()
    Path(a.output).write_text(json.dumps(inventory(a.input),ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
