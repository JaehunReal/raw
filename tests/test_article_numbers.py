import unittest
import xml.etree.ElementTree as ET
from rulecraft.article_numbers import normalize_provisions
from rulecraft.law_sources import _provisions

class ArticleNumbersTest(unittest.TestCase):
    def test_ingestion_and_existing_records(self):
        for raw, number in [('000100','제1조'),('000102','제1조의2'),('010000','제100조')]:
            root=ET.fromstring(f'<조문><조><조문번호>{raw}</조문번호><조문여부>Y</조문여부><조내용>{number}(목적) 원문</조내용></조></조문>')
            self.assertEqual(_provisions(root, [], 'ordinance')[0]['article_no'],number)
            old=[{'article_no':f'제{int(raw)}조','metadata':{'original_article_no':raw},'text':'원문'}]
            fixed=normalize_provisions('ordinance',old)
            self.assertEqual(fixed[0]['article_no'],number)
            self.assertEqual(old[0]['article_no'],f'제{int(raw)}조')
            self.assertEqual(normalize_provisions('ordinance',fixed),fixed)
            self.assertEqual(normalize_provisions('law',old),old)

if __name__ == '__main__': unittest.main()
