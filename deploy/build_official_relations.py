"""Index explicit named law citations; preserve source version and evidence."""
import os,re,json
from pathlib import Path
from collections import defaultdict
import psycopg
ROOT=Path(__file__).resolve().parents[2]
normalize=lambda s:re.sub(r'\s+','',s)
pattern=re.compile(r'[「『]([^」』\n]{2,180})[」』]')
with psycopg.connect('dbname=rulecraft host=/tmp') as db:
 db.execute('''CREATE TABLE IF NOT EXISTS public.rulecraft_official_relations (
 source text NOT NULL,law_id text NOT NULL,version_id text NOT NULL,target_source text NOT NULL,
 target_law_id text NOT NULL,cited_title text NOT NULL,kind text NOT NULL,evidence text NOT NULL,
 source_sha256 text NOT NULL,PRIMARY KEY(source,law_id,version_id,target_source,target_law_id))''')
 db.execute('CREATE INDEX IF NOT EXISTS official_relations_target ON public.rulecraft_official_relations(target_source,target_law_id)')
 db.execute('GRANT SELECT ON public.rulecraft_official_relations TO rulecraft_web_reader')
 names=defaultdict(set)
 for source,law_id,title in db.execute('SELECT DISTINCT source,law_id,title FROM documents'):
  names[normalize(title)].add((source,law_id,title))
 stats={'documents':0,'edges':0,'ambiguous_mentions':0}
 with db.cursor(name='official_citations') as cursor:
  cursor.execute('SELECT source,law_id,version_id,title,text,raw_sha256 FROM documents')
  while rows:=cursor.fetchmany(500):
   edges=[]
   for source,lid,vid,title,text,sha in rows:
    stats['documents']+=1;seen=set()
    for match in pattern.finditer(text):
     targets=names.get(normalize(match[1]),set());identities={(x[0],x[1]) for x in targets}
     if len(identities)>1:stats['ambiguous_mentions']+=1;continue
     if len(identities)!=1:continue
     ts,tid=next(iter(identities))
     if (ts,tid)==(source,lid) or (ts,tid) in seen:continue
     seen.add((ts,tid));kind='citation'
     if normalize(title) in {normalize(match[1])+'시행령',normalize(match[1])+'시행규칙'}:kind='implementation_basis'
     evidence=text[max(0,match.start()-70):min(len(text),match.end()+150)]
     edges.append((source,lid,vid,ts,tid,match[1],kind,evidence,sha))
   with db.cursor() as writer:
    writer.executemany('INSERT INTO public.rulecraft_official_relations VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',edges)
   stats['edges']+=len(edges)
 db.execute('ANALYZE public.rulecraft_official_relations')
(ROOT/'exports/official-relations-index.json').write_text(json.dumps(stats,indent=2))
print(json.dumps(stats))
