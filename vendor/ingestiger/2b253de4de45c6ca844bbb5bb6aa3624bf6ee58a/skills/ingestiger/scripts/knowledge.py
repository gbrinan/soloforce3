"""One reviewed candidate -> portable canonical files. No I/O or model authority.

The host supplies verified candidates, prior files and a human review, then owns
authorization, source rechecks, writer locking and atomic pointer replacement.
"""
import hashlib
import json
import re


def sha(value):
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n'


def record(markdown):
    if not markdown.startswith('---\n'):
        raise ValueError('Missing canonical metadata')
    return json.loads(markdown.split('\n---\n', 1)[0][4:])


def compose(previous, candidate, review):
    """Build a complete snapshot; never mutate the previous snapshot in place."""
    if review['verdict'] != 'accept' or review['conditionsChecked'] is not True or not review['reason'].strip():
        raise ValueError('Human semantic review required')
    if candidate['status'] != 'analyzed' or candidate['claim_status'] != 'source_reported':
        raise ValueError('Unresolved candidate')
    if candidate['owner_scope'] != review['scope']:
        raise ValueError('Scope mismatch')
    target = review['knowledgeId']
    if not re.fullmatch(r'K-[a-f0-9-]{36}', target):
        raise ValueError('Invalid stable ID')
    files = dict(previous)
    records = {}
    for name, markdown in previous.items():
        if name in ('index.md', 'relations.json') or re.fullmatch(r'reviews/[a-f0-9]{64}\.json', name):
            continue
        if not re.fullmatch(r'knowledge/K-[a-f0-9-]{36}\.md', name):
            raise ValueError('Unexpected canonical file')
        item = record(markdown)
        if item['owner_scope'] != review['scope'] or name != f"knowledge/{item['id']}.md":
            raise ValueError('Canonical scope mismatch')
        records[item['id']] = item
    old = records.get(target)
    if (old['revision'] if old else None) != review['expectedRevision']:
        raise ValueError('Knowledge revision conflict')
    origin = {key: review[key] for key in ('jobId', 'candidateId', 'unitId', 'needIndex')}
    if any(item['origin'] == origin and item['id'] != target for item in records.values()):
        raise ValueError('Candidate already has a stable ID')
    revision = old['revision'] + 1 if old else 1
    item = {
        'id': target, 'revision': revision, 'kind': candidate.get('kind', 'unknown'),
        'owner_scope': review['scope'], 'title': candidate['title'], 'statement': candidate['statement'],
        'departments': candidate['departments'], 'domains': [], 'patterns': candidate['patterns'],
        'details': candidate['details'], 'evidence': candidate['evidence'], 'provenance': candidate['provenance'],
        'claim_status': 'source_reported', 'lifecycle': 'current', 'semantic_review': 'accepted',
        'recorded_at': review['recordedAt'], 'valid_from': 'unknown', 'valid_to': 'unknown',
        'origin': origin, 'review_id': review['id'],
        'conditions': {'status': 'human_checked_selected_units', 'coverage': review['coverage'],
                       'unread_dependencies': 'unverified', 'note': review['reason']},
    }
    # JSON is a YAML subset. Machine-readable frontmatter is the sole fact source;
    # the body is its human-readable rendering in the same hashed file.
    body = f"# {item['title']}\n\n{item['statement']}\n\n"
    body += '\n'.join('- ' + detail for detail in item['details']) + '\n\n'
    body += '## 근거\n\n' + '\n'.join('> ' + quote.replace('\n', '\n> ') for quote in item['evidence']) + '\n'
    files[f'knowledge/{target}.md'] = '---\n' + encode(item) + '---\n\n' + body
    files['relations.json'] = encode({'relations': [], 'status': 'not_evaluated'})
    files[f"reviews/{review['id']}.json"] = encode(review)
    files['index.md'] = '# 프로젝트 정본\n\n' + '\n'.join(
        f'- [{key}](knowledge/{key}.md)' for key in sorted(set(records) | {target})) + '\n'
    manifest = {'schemaVersion': 1, 'scope': review['scope'], 'baseSnapshot': review['baseSnapshot'],
                'reviewId': review['id'], 'changed': {'id': target, 'revision': revision},
                'files': {name: sha(text) for name, text in sorted(files.items())}}
    files['manifest.json'] = encode(manifest)
    return {'snapshot': sha(files['manifest.json']), 'files': files, 'knowledge': item}
