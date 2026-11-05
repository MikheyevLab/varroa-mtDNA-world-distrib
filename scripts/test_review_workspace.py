#!/usr/bin/env python3
"""Exercise certification boundaries on synthetic records, never on the atlas ledger."""
import copy
import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from review_workspace import CHECKS, ReviewServer, ReviewStore


class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='varroa-review-test-')
        self.record=dict(record_id='TEST1',dataset='sequence',origin='new_import',source={'host':'unknown'},
                         species='Varroa test',country='Test',reference='Synthetic source')
        self.store=ReviewStore(self.temp.name,lambda:[copy.deepcopy(self.record)])

    def tearDown(self):
        self.temp.cleanup()

    def payload(self,action='verify',**changes):
        return dict(action=action,record_id='TEST1',fingerprint=self.store.records()[0]['fingerprint'],
                    author='Synthetic reviewer',author_role='human',attest=True,checks={k:True for k in CHECKS},
                    text='Synthetic source checked',**changes)

    def test_verify_release_and_changed_source(self):
        with self.assertRaises(ValueError): self.store.write(self.payload('release'))
        result=self.store.write(self.payload())
        self.assertEqual(result['record']['verification_status'],'verified')
        self.assertEqual(result['record']['publication_status'],'pending_review')
        self.store.write(self.payload('release'))
        self.assertEqual(self.store.records()[0]['publication_status'],'published')
        before=self.payload()
        self.record['source']['host']='A. cerana'
        self.assertEqual(self.store.records()[0]['verification_status'],'needs_recheck')
        self.assertEqual(self.store.records()[0]['publication_status'],'pending_review')
        with self.assertRaises(ValueError): self.store.write(before)
        self.assertEqual(len(self.store.ledger.read_text().splitlines()),2)

    def test_human_and_complete_checks_required(self):
        for key,value in [('author_role','assistant'),('attest',False),('author',''),('checks',{'source':True})]:
            payload=self.payload();payload[key]=value
            with self.subTest(key=key),self.assertRaises(ValueError): self.store.write(payload)
        self.assertFalse(self.store.ledger.exists())

    def test_notes_questions_and_resolution_are_not_certification(self):
        source=copy.deepcopy(self.record)
        payload=self.payload('note');payload.update(kind='correction',author_role='assistant',field='host',proposed_value='A. cerana')
        result=self.store.write(payload)
        note=result['notes'][0]['note_id']
        self.assertEqual(self.record,source)
        self.assertEqual(result['record']['verification_status'],'not_verified')
        self.assertEqual(result['open_issues'],1)
        with self.assertRaises(ValueError): self.store.write(self.payload())
        payload.update(kind='note',resolves=note)
        with self.assertRaises(ValueError): self.store.write(payload)
        payload.update(kind='resolution')
        with self.assertRaises(ValueError): self.store.write(payload)
        payload.update(author_role='human',text='Retain documented unknown; checked synthetic table.')
        result=self.store.write(payload)
        self.assertEqual(result['open_issues'],0)
        self.assertFalse(self.store.ledger.exists())
        self.assertEqual(self.store.write(self.payload())['record']['verification_status'],'verified')

    def test_old_notes_remain_visible_with_version_flag(self):
        self.store.write(self.payload('note',kind='question'))
        self.record['country']='Changed location'
        result=self.store.detail('TEST1')
        self.assertFalse(result['notes'][0]['current_version'])
        self.assertEqual(result['open_issues'],0)
        payload=self.payload('note',kind='resolution',resolves=result['notes'][0]['note_id'])
        with self.assertRaises(ValueError): self.store.write(payload)

    def test_http_origin_token_and_local_only(self):
        docs=Path(self.temp.name)/'docs';docs.mkdir();(docs/'index.html').write_text('test')
        server=ReviewServer(0,self.store,docs=docs,rebuild=False)
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        host=f'127.0.0.1:{server.server_port}'
        def request(method,path,headers=None,payload=None):
            conn=http.client.HTTPConnection('127.0.0.1',server.server_port)
            conn.request(method,path,body=json.dumps(payload) if payload else None,headers=headers or {})
            response=conn.getresponse();body=response.read();status=response.status;conn.close()
            return status,body
        try:
            code,body=request('GET','/api/review/session');self.assertEqual(code,200)
            token=json.loads(body)['token']
            payload=self.payload('note',kind='note')
            headers={'Origin':'http://'+host,'X-Review-Token':token,'Content-Type':'application/json'}
            self.assertEqual(request('POST','/api/review/action',headers,payload)[0],200)
            self.assertEqual(request('POST','/api/review/action',{},payload)[0],403)
            bad={**headers,'Origin':'https://unrelated.example'}
            self.assertEqual(request('POST','/api/review/action',bad,payload)[0],403)
            self.assertEqual(request('GET','/api/review/session',{'Host':'unrelated.example'})[0],403)
            self.assertEqual(request('GET','/api/review/records?status=not_verified')[0],200)
            self.assertEqual(request('GET','/index.html')[0],200)
            self.assertEqual(request('GET','/../review_notes.jsonl')[0],404)
            self.assertFalse(self.store.ledger.exists())
        finally:
            server.shutdown();server.server_close();thread.join()


if __name__=='__main__': unittest.main()
