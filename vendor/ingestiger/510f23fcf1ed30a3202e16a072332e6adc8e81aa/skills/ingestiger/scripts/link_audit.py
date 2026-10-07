"""Offline audit of a sanitized Sheets cell snapshot. Never follows URLs or executes formulas."""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

URL = re.compile(r'https?://[^\s<>\[\]"\)]+')
LOCAL = re.compile(r'(?<![\w/:])(?:[A-Za-z]:[\\/](?!/)|sandbox:/|file:/|/Users/|/home/)\S*')
ROLES = ('unknown', 'header_or_example', 'instructor_reference', 'participant_material', 'source_material')

def cell_role(sheet, cell):
    role = cell.get('role', sheet.get('role', 'unknown'))
    if role not in ROLES: raise ValueError('Invalid explicit cell role')
    return role

def normalize(raw):
    raw = raw.strip().rstrip('.,;。')
    p = urlsplit(raw)
    if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
        raise ValueError('Unsupported URL')
    # Query and fragment may identify the actual artifact. Do not strip them.
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path, p.query, p.fragment))

def classify(url):
    p = urlsplit(url)
    if p.hostname in ('chatgpt.com', 'chat.openai.com'):
        if p.path.startswith('/c/') or '/c/' in p.path: return 'private_conversation'
        if p.path.startswith('/share/e/'): return 'workspace_share_candidate'
        if p.path.startswith('/share/'): return 'share_candidate'
        if p.path.startswith('/s/'): return 'message_link_candidate'
        return 'chatgpt_other'
    return 'external_link'

def audit(source):
    records = []; units = []; exceptions = []; cells = 0
    for sheet in source['sheets']:
        for cell in sheet['cells']:
            cells += 1
            loc = sheet['title']+'!'+cell['cell']
            role = cell_role(sheet, cell)
            val = cell.get('value', {})
            text = str(val.get('stringValue', val.get('numberValue', '')))
            formula = val.get('formulaValue', '')
            raw_links = list(dict.fromkeys(URL.findall(text+' '+formula)+cell.get('links', [])))
            normalized = set()
            for raw in raw_links:
                try: normalized.add(normalize(raw))
                except ValueError: exceptions.append({'locator':loc,'reason':'malformed_url'})
            for url in sorted(normalized):
                records.append({'url':url,'locator':loc,'role':role,'kind':classify(url),
                    'access_status':'not_probed','content_status':'not_read','admission':'pending',
                    'remedy':'Provide an accessible export or authorized source content; retain this locator.'})
            displayed = set(URL.findall(text))
            targets = set(cell.get('links', []))
            if displayed and targets and displayed != targets:
                exceptions.append({'locator':loc,'reason':'display_target_mismatch'})
            if LOCAL.search(text): exceptions.append({'locator':loc,'reason':'local_attachment_required'})
            if formula or cell.get('error'):
                exceptions.append({'locator':loc,'reason':'formula_error' if cell.get('error') else 'formula_requires_review'})
                continue  # Never promote a formula or an unverified cached formula result.
            cleaned = LOCAL.sub('[local attachment pending]', URL.sub('', text)).strip()
            # Link labels may imply unseen content; preserve as source-reported text only.
            if cleaned:
                units.append({'unit_id':loc,'locator':loc,'text':cleaned,'source_kind':'cell_text',
                    'role':role,'claim_status':'source_reported','linked_content':'not_included'})
    return {'schema_version':'1','spreadsheet_id':source['spreadsheet_id'],
        'source_revision':hashlib.sha256(json.dumps(source,sort_keys=True,ensure_ascii=False).encode()).hexdigest(),
        'summary':{'sheets':len(source['sheets']),'nonempty_cells':cells,'url_occurrences':len(records),
                   'unique_urls':len({r['url'] for r in records}),'kinds':dict(Counter(r['kind'] for r in records)),
                   'exceptions':dict(Counter(e['reason'] for e in exceptions))},
        'links':records,'exceptions':exceptions,'units':units,
        'policy':'No linked content admitted. Readability is not factual verification. Do not discard entire rows.'}

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('output')
    a=p.parse_args(); result=audit(json.loads(Path(a.input).read_text(encoding='utf-8')))
    Path(a.output).write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result['summary'],ensure_ascii=False))
if __name__=='__main__':main()
