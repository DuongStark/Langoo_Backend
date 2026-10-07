import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('prepare', Path(__file__).with_name('ja-bccwj-prepare.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def lexeme(id, lemma='入る', reading='はいる', pos='verb', attributes=None):
    return {'id':str(id),'external_id':f'jmdict:{id}', 'lemma':lemma,'reading':reading,'pos':pos,'attributes':attributes or {},'input_hash':'a'*32}


def corpus(lemma='入る', reading='ハイル', pos='動詞-一般', rank='100'):
    return {'lemma':lemma,'lForm':reading,'pos':pos,'rank':rank,'frequency':'500'}


class PreparationTest(unittest.TestCase):
    def prepare(self, lexemes, rows):
        return module.prepare({'target_identity':'test','lexemes':lexemes},rows,'0'*64)

    def test_reading_and_pos_disambiguate(self):
        result,_=self.prepare([lexeme(1),lexeme(2,reading='いる'),lexeme(3,pos='noun')],[corpus()])
        self.assertEqual([x['lexeme_id'] for x in result['lexemes']],['1'])

    def test_ambiguous_is_never_assigned(self):
        result,audit=self.prepare([lexeme(1),lexeme(2)],[corpus()])
        self.assertEqual(result['lexemes'],[])
        self.assertEqual(len(audit['ambiguous']),1)

    def test_reading_restricted_spelling(self):
        attrs={'kanji':[{'text':'甲'},{'text':'乙'}],'kana':[{'text':'こう','appliesToKanji':['甲']}]}
        result,_=self.prepare([lexeme(1,'甲','こう','noun',attrs)],[corpus('乙','コウ','名詞-普通名詞-一般')])
        self.assertEqual(result['lexemes'],[])

    def test_corpus_identities_are_not_summed(self):
        result,_=self.prepare([lexeme(1)],[corpus(rank='100'),corpus(rank='200')])
        self.assertEqual(result['lexemes'][0]['corpus_count'],500)
        self.assertEqual(len(result['lexemes'][0]['evidence']),2)

    def test_valid_kana_spelling_can_match(self):
        result,_=self.prepare([lexeme(1,'乃','の','particle')],[corpus('の','ノ','助詞-格助詞')])
        self.assertEqual(result['lexemes'][0]['lexeme_id'],'1')

    def test_unknown_pos_does_not_guess(self):
        result,_=self.prepare([lexeme(1)],[corpus(pos='unknown')])
        self.assertEqual(result['lexemes'],[])


if __name__=='__main__': unittest.main()
